# Photoshop-подобная работа с перспективой, текстом и растровыми инструментами

Дата: 2026-08-11

Статус: согласовано пользователем

Ветка реализации: `feature/photoshop-like-canvas-ux`

## Цель

Устранить видимые клеточные артефакты перспективной деформации и привести основные интерактивные инструменты редактора к предсказуемому Photoshop-подобному поведению:

- цельная перспективная деформация без треугольных швов;
- создание абзацного текста рамкой с переносом строк при изменении её размера;
- отсутствие случайных пустых или дублирующихся текстовых слоёв;
- настоящий live-preview кисти, размытия и пикселизации вместо цветной линии, похожей на маску;
- раздельные и понятные параметры размера, жёсткости и силы эффекта;
- дополнительные практичные инструменты для манги: пипетка, штамп, резкость и палец;
- единая семантика lock, undo, pointer capture и рендера во всех путях редактора.

Существующие Vercel API, `app/api/*`, env-переменные, RouterAI/Clipdrop-контракты и серверная логика не изменяются.

## Исходные проблемы

### Перспектива

Текущий `drawPerspectiveImage` делит изображение на прямоугольную сетку, а каждую ячейку — на два Canvas 2D-треугольника. Антиалиасинг отдельных clip-path создаёт субпиксельные зазоры. Низкое число сегментов во время preview также делает структуру сетки заметной при сильной деформации.

### Текст

Текущий Text tool создаёт и сохраняет `TextObject` на каждый клик и остаётся активным после вставки. `Konva.Transformer` меняет `scaleX/scaleY`, поэтому рамка масштабирует буквы вместо изменения ширины абзаца и переноса строк.

### Растровые эффекты

Во время движения Blur/Pixelate/Noise показывается синяя Konva-линия с `shadowBlur`. Настоящий эффект вычисляется только после отпускания указателя. Аналогично live-preview обычной кисти визуально приближает жёсткость через толщину и тень, тогда как финальный растр использует brush stamps. Это делает preview похожим на маску и не позволяет заранее понять действие жёсткости.

## Рассмотренные варианты перспективного рендера

### 1. Только исправление Canvas-сетки

Расширять clip-треугольники на 0.5–1 device pixel и адаптивно увеличивать subdivisions. Это минимальная доработка, но при экстремальной перспективе, прозрачных краях и большом zoom швы могут вернуться.

### 2. WebGL-гомография с Canvas fallback — выбранный вариант

Рендерить проектированное изображение одним fragment-shader проходом через обратную матрицу гомографии. Сетка и внутренние границы отсутствуют как класс. Canvas-сетка остаётся fallback для недоступного или потерянного WebGL context.

### 3. CPU inverse mapping

Считать каждый destination pixel через `ImageData` или Worker. Результат точный, но интерактивная работа с большими страницами слишком дорогая по CPU и памяти.

## Архитектура перспективного рендера

### Общий контракт

Сохраняется единая высокоуровневая функция:

```ts
drawPerspectiveImage(ctx, source, quad, options)
```

Она выбирает backend и используется для:

- Canvas preview базового слоя;
- AI- и drawing-слоёв;
- `buildCleanupSourceCanvas` и источников AI/Clipdrop;
- PNG/JPEG/ZIP export compositor;
- запекания drawing-слоя;
- финального обновления после drag.

`options` получает профиль качества:

```ts
type PerspectiveQuality = 'drag' | 'preview' | 'export';
```

- `drag`: размер соответствует реальному экранному размеру слоя с разумным верхним пределом;
- `preview`: полное разрешение текущего editor preview;
- `export`: документное разрешение без понижения качества.

После окончания drag всегда запускается `preview`-перерисовка. Export и AI source никогда не используют временный drag-cache.

### WebGL backend

- Один reusable WebGL canvas/context на renderer, а не новый context на каждый кадр.
- 3×3 homography вычисляется между прямоугольником source и `PerspectiveQuad`.
- Fragment shader преобразует destination coordinate обратной матрицей, делит `xy` на `w` и берёт texture sample.
- Пиксели вне source rectangle прозрачны.
- Texture wrap: `CLAMP_TO_EDGE`; фильтрация: `LINEAR` для обычных изображений.
- Альфа остаётся premultiplied на всём пути, чтобы прозрачные края не получали чёрный или серый ореол.
- Результат рисуется в ограниченный bounding rectangle quad, затем композитится в переданный Canvas 2D context.
- Texture и итоговый surface кешируются по identity/revision источника, quad, quality и размерам.
- При `webglcontextlost`, ошибке shader compilation или отсутствии WebGL функция прозрачно переходит на Canvas fallback.

### Canvas fallback

- Сохраняется адаптивная сетка с пределами по размеру и степени деформации.
- Clip-треугольник расширяется наружу примерно на 0.75 device pixel без изменения внешней границы quad.
- Соседние source triangles получают минимальный bleed, достаточный для bilinear filtering.
- Число subdivisions выбирается по projective curvature и итоговому размеру, а не фиксированными 12/18/24.
- Один профиль качества используется во всех вызовах, чтобы preview и export не выбирали случайно разные сетки.

### Валидация quad

- Только выпуклый quad с одинаковым winding.
- Минимальная площадь и минимальная длина ребра зависят от размера слоя.
- Самопересечение, вырождение и переворот блокируются до изменения store.
- Один corner drag создаёт одну history запись.
- Lock никогда не снимается автоматически. На locked layer ручки перспективы неактивны.

## Photoshop-подобный текст

### Данные и совместимость

`TextObject` получает опциональные поля:

```ts
textMode?: 'point' | 'paragraph';
height?: number; // доля высоты документа для paragraph text
```

Старые документы без полей продолжают отображаться с существующими `width`, `scaleX`, `scaleY` и `rotation`. При первом изменении рамки объект переводится в `paragraph`, а накопленный horizontal scale запекается в `width`.

### Создание

- Pointer down и drag создают локальный `TextDraft`, но не пишут его в Zustand и history.
- Рамка показывается во время drag.
- Drag больше небольшого screen-space threshold создаёт paragraph text.
- Короткий клик создаёт point-text draft с безопасной шириной, но объект попадает в документ только после ввода хотя бы одного непробельного символа.
- Сразу открывается DOM textarea, синхронизированная с рамкой, zoom, rotation, шрифтом, stroke и shadow.
- `Enter` вставляет новую строку.
- `Ctrl/Cmd+Enter` подтверждает.
- Клик вне редактора подтверждает непустой текст.
- `Esc` удаляет новый draft либо восстанавливает старое значение редактируемого объекта.
- После успешного создания автоматически включается Select tool.
- Пустой draft не создаёт слой и не создаёт history запись.

### Рамка и перенос

- Левые/правые/угловые anchors изменяют `width`, сбрасывая `scaleX` к 1; строки перераскладываются сразу.
- Верхние/нижние/угловые anchors изменяют `height` paragraph box.
- Обычное изменение рамки не меняет font size.
- `Ctrl/Cmd + corner drag` сохраняется как явное масштабирование текста для пользователей, которым оно нужно.
- Rotate handle остаётся отдельным.
- Если содержимое превышает высоту paragraph box, показывается компактный overflow marker; текст не удаляется.
- Double click существующего текста открывает тот же inline editor.
- Один create/edit/resize gesture создаёт одну undo запись.

## Единый brush-preview

### Общая форма кисти

Live overlay и финальный raster используют один stamp generator и одинаковые параметры:

- diameter;
- hardness;
- opacity/strength;
- color или effect mask alpha;
- spacing/interpolation;
- composite operation.

Konva Line с `shadowBlur` больше не изображает результат кисти или raster effect.

Cursor имеет:

- внешнюю окружность полного диаметра;
- внутреннюю окружность жёсткого центра;
- optional crosshair для точной работы;
- масштабирование относительно screen pixels независимо от zoom.

Горячие клавиши:

- `[` / `]` — размер;
- `Shift + [` / `Shift + ]` — жёсткость;
- временная пипетка через `Alt/Option` во время работы кистью.

Pointer points по-прежнему собираются через `getCoalescedEvents`, фильтруются в screen-space и сбрасываются не чаще одного `requestAnimationFrame`. Pointer capture ставится на фактический `event.target`, а window `pointerup`/`pointercancel`/`blur` остаются страховкой.

## Размытие, пикселизация, шум и резкость

### Интерактивная сессия

На pointer down создаётся `RasterEffectStrokeSession`:

1. Проверяет существование активного raster layer, visibility, lock и непустую selection до любой мутации.
2. Делает неизменяемый source snapshot для текущего stroke.
3. Готовит effect surface только для dirty bounds, расширенных на радиус фильтра.
4. Во время pointer move обновляет stamp mask и композитит настоящий результат в transient overlay максимум один раз за frame.
5. На pointer up строит full-resolution patch в тех же координатах и композитной формуле.
6. Делает один commit и одну history запись.
7. На cancel, tool switch или blur окна удаляет transient overlay без записи.

По умолчанию цветная mask overlay не показывается. Пользователь видит изменённые пиксели под курсором.

### Параметры по режимам

Blur:

- Size;
- Hardness;
- Radius;
- Strength.

Повторный stroke берёт предыдущий committed result как source и постепенно усиливает размытие.

Pixelate:

- Brush size;
- Hardness;
- Cell size;
- Mix/strength.

Блоки привязаны к координатам активного слоя, поэтому сетка не прыгает между stroke. Для Pixelate явно отключается image smoothing.

Noise:

- Brush size;
- Hardness;
- Amount;
- monochrome toggle;
- stable per-stroke seed для совпадения preview и commit.

Sharpen:

- Brush size;
- Hardness;
- Radius;
- Amount.

Preview использует editor-resolution patch; commit вычисляет patch в document/layer resolution. Для тяжёлых операций применяется `OffscreenCanvas`/Worker при наличии, fallback остаётся асинхронным и ограниченным dirty rectangle.

### Selection и locked layers

- Если есть активное выделение и включён режим ограничения выделением, итоговая alpha умножается на selection mask.
- Mask может ограничивать эффект, но не используется как основной визуальный preview.
- Locked base/AI/drawing layer нельзя изменить, очистить, размыть, пикселизировать, штамповать или перспективно деформировать.
- UI показывает явное сообщение «Слой заблокирован. Снимите блокировку» и не делает auto-unlock.

## Новые инструменты

### Пипетка (`I`)

- По умолчанию берёт цвет из итогового composited document preview.
- Опция Sample current layer доступна в быстрых настройках.
- Клик устанавливает foreground/brush color и возвращает предыдущий paint tool.
- `Alt/Option` временно включает пипетку из Brush/Clone Stamp.
- Цвет может быть применён к кисти, новому тексту и новым баблам через общий foreground color, без изменения существующих объектов.

### Штамп (`S`)

- `Alt/Option + click` задаёт source anchor.
- Следующий stroke копирует пиксели с постоянным offset относительно source anchor.
- Режим `Aligned` включён по умолчанию.
- Cursor показывает destination brush и source crosshair.
- Использует те же Size, Hardness, Opacity и stamp interpolation.
- Один stroke — одна undo запись.
- Для перспективно деформированного слоя document coordinates преобразуются через inverse homography в layer coordinates.
- Вне source bounds stamp остаётся прозрачным и не растягивает крайние пиксели.

### Палец

- Переносит sampled pixels по направлению движения pointer.
- Strength управляет долей переноса, hardness — краем stamp.
- Не использует цветную mask overlay.
- Работает только на unlocked active raster layer и ограничивается selection при включённой опции.

## История и состояние

- Transient drafts, live strokes и drag preview хранятся вне Zustand document state.
- Store обновляется только при завершении жеста.
- Create text, resize text box, perspective corner drag и каждый raster stroke имеют по одной undo записи.
- Slider history начинается при pointer/keyboard/wheel interaction и закрывается одной записью на весь continuous gesture.
- Page/tool/layer switch сначала завершает или отменяет активную операцию по явному правилу; асинхронный результат проверяет document ID и layer ID перед commit.
- Никакая операция не снимает `locked` автоматически.

## Производительность

- Не более одного live render на animation frame.
- Dirty-rectangle processing вместо полного document canvas для raster strokes.
- WebGL program/context и textures переиспользуются.
- Preview cache инвалидируется revision ключом слоя, а не каждым React render.
- React/Zustand не обновляются на pointermove.
- Full-resolution commit показывает короткое состояние «Применяем…» и остаётся отменяемым до store commit.
- Context loss и отсутствие OffscreenCanvas имеют рабочие fallback без потери документа.

## Ошибки и восстановление

- Ошибка preview не изменяет store.
- Ошибка full-resolution commit удаляет transient overlay и оставляет исходный слой.
- WebGL context loss переключает перспективу на Canvas fallback и показывает ненавязчивое предупреждение один раз.
- Пустой текст, пустой stroke, источник Clone Stamp вне слоя и locked layer отбрасываются до history и тяжёлого рендера.
- При смене документа pending async result не может попасть на другую страницу.

## Проверка

### Unit и raster tests

- homography source↔quad и inverse mapping;
- выпуклость, winding, минимальная площадь, запрет self-intersection;
- Canvas fallback без внутренних прозрачных/цветных швов на checkerboard;
- одинаковые границы alpha для preview/export;
- text drag threshold, point/paragraph mode и отсутствие пустого объекта;
- изменение width перераскладывает строки и оставляет `scaleX = 1`;
- Enter создаёт строку, Ctrl/Cmd+Enter подтверждает, Esc отменяет;
- brush hardness 0/50/100 для preview и committed raster;
- blur radius/strength, pixel cell size, noise seed, sharpen amount;
- selection clipping и locked-layer rejection;
- eyedropper composite sampling;
- clone offset, aligned mode, perspective inverse mapping;
- один gesture — одна history запись.

### Browser smoke

- Checkerboard и фото перспективно деформируются каждым углом; на 400% zoom нет квадратной сетки.
- После drag окончательный preview совпадает с PNG export и cleanup/AI source с небольшим pixel tolerance только на ресемплинг.
- Drag текстовой рамки создаёт paragraph text; изменение боковой ручки переносит строки без растягивания глифов.
- Пустой текст и последовательные случайные клики не создают слои.
- Длинный brush/effect stroke остаётся непрерывным при mouse, pen и touch; отпускание вне canvas завершает stroke.
- Blur показывает настоящий эффект в процессе, повторный stroke усиливает его, Ctrl+Z отменяет ровно последний stroke.
- Pixelate использует стабильную сетку и чёткие блоки.
- Locked raster layer не меняется ни одним новым или существующим raster/perspective action.
- Eyedropper и Clone Stamp корректно работают на обычном и перспективном слое.

### Команды финальной проверки

- `npm test`;
- `npx tsc --noEmit`;
- `npm run lint`;
- `npm run build`;
- `git diff --check`;
- browser smoke на локальной production build;
- после публикации — smoke на Vercel без платных AI-вызовов.

## Критерии готовности

- На перспективно деформированном изображении отсутствуют квадратные/треугольные швы в preview и export.
- Размер текстовой рамки управляет переносом, а не масштабом букв.
- Случайный клик Text tool не оставляет новый слой; после commit включается Select.
- Жёсткость визуально понятна по cursor и совпадает в live/commit/export.
- Blur/Pixelate показывают реальный результат, а не цветную линию-маску.
- Pointermove не пишет в Zustand и не вызывает больше одного live render за frame.
- Lock и undo единообразны для всех перечисленных действий.
- API и server contracts не изменены.

## Вне scope

- полноценный mesh warp/liquify с произвольной сеткой;
- PSD import/export;
- изменение AI, Clipdrop и RouterAI endpoint-ов;
- автоматические платные AI retry;
- vector text-on-path и полный typographic engine Photoshop.
