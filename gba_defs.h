#ifndef _GBA_DEFS_H
#define _GBA_DEFS_H

typedef signed char i8;
typedef unsigned char u8;
typedef signed short i16;
typedef unsigned short u16;
typedef signed int i32;
typedef unsigned int u32;

// ======================
// =    КАРТА ПАМЯТИ    =
// ======================

#define EW_RAM_START		0x02000000
#define EW_RAM_SIZE		262144
#define IW_RAM_START		0x03000000
#define IW_RAM_SIZE		32768
#define IO_RAM_START		0x04000000
#define IO_RAM_SIZE		1024
#define BGR_PAL_RAM_START	0x05000000
#define BGR_PAL_RAM_SIZE	512
#define SPR_PAL_RAM_START	0x05000200
#define SPR_PAL_RAM_SIZE	512
#define VID_RAM_START		0x06000000
#define VID_RAM_SIZE		98304
#define OAM_RAM_START		0x07000000
#define OAM_RAM_SIZE		1024
#define ROM_START		0x08000000
#define SRAM_START		0x0E000000
#define SRAM_SIZE		32768

#define SRAM_BUFFER		((volatile u8 *) SRAM_START)

// ======================
// =       ВИДЕО        =
// ======================

// Макрос RGB показывает раскладку цветов 15-битного цвета
#define RGB(r,g,b)  ((r)+((g)<<5)+((b)<<10)) 

// *** РЕГИСТР КОНТРОЛЯ ВИДЕОРЕЖИМА
#define REG_DISPCNT	(*((volatile u32 *) 0x4000000))
// Флаги регистра:
// Биты 0-2: номер видеорежима
// Режим 0: 240x160 - тайловый видеорежим. Доступны 4 скроллируемых задних плана (BG0-BG3).
#define MODE_0		0x0
// Режим 1: 240x160 - тайловый видеорежим. Доступны 2 скроллируемых задних плана (BG0-BG1)
// и один с афинными трансформациями (BG2).
#define MODE_1		0x1
// Режим 2: 240x160 - тайловый видеорежим. Доступны 2 задних плана с афинными 
// трансформациями (BG2-BG3).
#define MODE_2		0x2
// Режим 3: 240x160x15. Начинается с адреса 0x06000000, каждый пиксель занимает 2 байта 
// 15-битного RGB-цвета. Из-за большой величины видеобуфера не имеет второй страницы.
#define MODE_3		0x3
// Режим 4: 240x160x8. Начинается с адреса 0x06000000, имеет вторую страницу по адресу 
// 0x0600A000. Переключение между видеостраницами контролируется битом MODE_PAGE_2, что 
// позволяет реализовать буферизацию. Однобайтовые пиксели хранят индекс в 16-битной 
// палитре из 256 ячеек по адресу BGR_PALETTE.
#define MODE_4		0x4
// Режим 5: 160x128x16. Начинается с адреса 0x06000000, из-за пониженного разрешения 
// тоже имеет вторую страницу по адресу 0x0600A000.
#define MODE_5		0x5
// Бит 4: для пиксельных режимов переключает отображение на вторую страницу.
#define MODE_PAGE_2		0x0010
// Бит 5: если 1, то видеоадаптер разрешает доступ к OAM во время интервалов HBlank ценой
// сокращения количества одновременно отображаемых на одной строке спрайтов.
#define MODE_HBLANK_IS_FREE	0x0020
// Бит 6: Режим компоновки многотайловых спрайтов (больше чем 8x8 пикселей).
//        В таких спрайтах опорный тайл (индекс) выступает в роли левого-верхнего, остальные 
//        компонуются к нему следующим образом:
//        1 - линейный режим, тайлы выбираются подряд для формирования строк и колонок 
//            многотайлового спрайта
//        0 - массив тайлов образуют двумерный массив с шириной строки в 32 тайла и 
//            спрайты компонуются по соседним ячейкам в этом массиве графически-естественно.
#define MODE_LINEAR_SPRITES	0x0040
// Бит 7: Выключить дисплей - видеоадаптер будет продолжать обновлять строки экрана, но
// белым цветом, не обращаясь к видеопамяти, что позволяет работать с ней на полной скорости.
#define MODE_DISPLAY_OFF	0x0080
// Биты 8-11: включить задник BG0-BG3. 
// В пиксельных видеорежимах экран считается задником BG2.
#define BG0_ENABLE		0x0100
#define BG1_ENABLE		0x0200
#define BG2_ENABLE		0x0400
#define BG3_ENABLE		0x0800
// Бит 12: включить отображение спрайтов.
#define SPR_ENABLE		0x1000
// Биты 13-15: включить окна.
#define WIN0_ENABLE		0x2000
#define WIN1_ENABLE		0x4000
#define SPRWIN_ENABLE		0x8000

// *** РЕГИСТР ТЕКУЩЕЙ ВЫВОДИМОЙ НА ЭКРАН СТРОКИ ПИКСЕЛЕЙ
// Меняется от 0 до 159 во время отображения строк дисплея и после еще увеличивается 68 раз 
// до повторения цикла обновления экрана. 
#define REG_VCOUNT	(*((volatile u16 *) 0x4000006))

// *** РЕГИСТРЫ УПРАВЛЕНИЯ ТАЙЛОВЫМИ ФОНАМИ
#define REG_BG0CNT	(*((volatile u16 *) 0x4000008))
#define REG_BG1CNT	(*((volatile u16 *) 0x400000A))
#define REG_BG2CNT	(*((volatile u16 *) 0x400000C))
#define REG_BG3CNT	(*((volatile u16 *) 0x400000E))
// Битовые флаги:
// Приоритет (от 0 до 3)
#define BG_PRIORITY(x)		(x)
// Адрес начала данных тайлов (массивы пикселей TILE DATA)
#define	BG_TILE_DATA_AT_0000	0x00
#define	BG_TILE_DATA_AT_4000	0x04
#define	BG_TILE_DATA_AT_8000	0x08
#define	BG_TILE_DATA_AT_C000	0x0C
// Режим мозаики
#define BG_MOSAIC		0x40
// Пиксели в тайлах 8-битные (байт), иначе селектор тайла 
// хранит индекс одной из 16 палитр, а пиксели в тайлах 4-битные.
#define BG_COLOR_256		0x80
// Логический адрес начала карты тайлов (от 0 до 31) - он записывается в регистр.
#define BG_TILE_MAP_AT(x)	((x)<<8)
// Получить адрес начала карты тайлов, увеличение логического номера
// увеличивает его на 2048 байт, начиная с начала VID_RAM.
#define BG_TILE_MAP_ADDR(x)	(0x6000000 + (x) * 0x800)
// Режим повторения для вращающегося фона
#define BG_ROT_OVERLAP		0x2000
// Размеры текстовых фонов (TILE MAP)
#define	BG_SIZE_256x256		0x0000
#define	BG_SIZE_512x256		0x4000
#define	BG_SIZE_256x512		0x8000
#define	BG_SIZE_512x512		0xC000
// Размеры вращающихся фонов (TILE MAP)
#define	BG_ROT_SIZE_128x128	0x0000
#define	BG_ROT_SIZE_256x256	0x4000
#define	BG_ROT_SIZE_512x512	0x8000
#define	BG_ROT_SIZE_1024x1024	0xC000

// *** Регистры горизонтального и вертикального смещений текстовых фонов
// Они не работают для вращающихся фонов - для последних существуют свои регистры.
// HOFS - это горизонтальная, а VOFS - вертикальная координаты пикселя соответствующего
// фона, который будет находится в самом левом-верхнем углу экрана.
#define REG_BG0HOFS	(*((volatile u16 *) 0x4000010))
#define REG_BG0VOFS	(*((volatile u16 *) 0x4000012))
#define REG_BG1HOFS	(*((volatile u16 *) 0x4000014))
#define REG_BG1VOFS	(*((volatile u16 *) 0x4000016))
#define REG_BG2HOFS	(*((volatile u16 *) 0x4000018))
#define REG_BG2VOFS	(*((volatile u16 *) 0x400001A))
#define REG_BG3HOFS	(*((volatile u16 *) 0x400001C))
#define REG_BG3VOFS	(*((volatile u16 *) 0x400001E))

// *** Регистры горизонтального и вертикального смещений вращающихся фонов,
// а так же коэффициентов матриц афинных преобразований для них.
// Работают только для BG2 и BG3 в режиме вращения/масштабирования.
// Коэффиценты афинной матрицы BG2 (PA, PB, PC, PD):
#define REG_BG2PA	(*((volatile i16 *) 0x4000020))
#define REG_BG2PB	(*((volatile i16 *) 0x4000022))
#define REG_BG2PC	(*((volatile i16 *) 0x4000024))
#define REG_BG2PD	(*((volatile i16 *) 0x4000026))
// Координаты BG2 (PX, PY):
#define REG_BG2X	(*((volatile u32 *) 0x4000028))
#define REG_BG2Y	(*((volatile u32 *) 0x400002C))
// Коэффициенты афинной матрицы BG3 (PA, PB, PC, PD):
#define REG_BG3PA	(*((volatile i16 *) 0x4000030))
#define REG_BG3PB	(*((volatile i16 *) 0x4000032))
#define REG_BG3PC	(*((volatile i16 *) 0x4000034))
#define REG_BG3PD	(*((volatile i16 *) 0x4000036))
// Координаты BG3 (PX, PY):
#define REG_BG3X	(*((volatile u32 *) 0x4000038))
#define REG_BG3Y	(*((volatile u32 *) 0x400003C))

// *** РЕГИСТР СТАТУСА ВИДЕОАДАПТЕРА
#define REG_DISPSTAT		(*((volatile u16 *) 0x4000004))
// Регистр тайминга доступа к ROM/SRAM картриджа (WAITCNT). НИГДЕ в проекте
// раньше не выставлялся — то есть используется значение по сбросу (0x0000),
// это САМЫЕ медленные wait-states из возможных и выключенный prefetch-буфер.
// Раз почти весь код и данные читаются из ROM, это может ощутимо тормозить
// буквально всё в игре, а не что-то конкретное. 0x4317 — стандартное "быстрое
// и безопасное" значение (WS0: 3/1 такта, префетч включён), которое ставит
// подавляющее большинство GBA-игр/хомбрю при старте.
#define REG_WAITCNT		(*((volatile u16 *) 0x4000204))
// Флаги:
// Бит 0: 1, если происходит VBlank (но лучше проверять через REG_VCOUNT)
#define STAT_VBLANK		0x0001
// Бит 1: 1, если происходит HBlank
#define STAT_HBLANK		0x0002
// Бит 2: 1, если произошло прерывание по VCOUNT
#define STAT_VCOUNT		0x0004
// Бит 3: Управление генерацией прерывания в начале VBlank
#define VBLANK_IRQ_ENABLE	0x0008
// Бит 4: Управление генерацией прерывания в начале HBlank
#define HBLANK_IRQ_ENABLE	0x0010
// Бит 5: Управление генерацией прерывания по VCOUNT
#define VCOUNT_IRQ_ENABLE	0x0020
// Биты 8-15: значение VCOUNT при котором происходит генерация этого прерывания
#define VCOUNT_IRQ_VALUE( x )	(((u16)x) << 8)

// *** ПАЛИТРЫ И НАЧАЛО ВИДЕОДАННЫХ

// Адрес палитры, используемой фоновыми задниками (256 ячеек по 2 байта RGB)
#define BGR_PALETTE ((u16 *) BGR_PAL_RAM_START)
// Адрес палитры, используемой спрайтами (256 ячеек по 2 байта RGB)
#define SPR_PALETTE ((u16 *) SPR_PAL_RAM_START)
// Основное начало видеобуфера
#define VID_BUFFER ((u16 *) VID_RAM_START)

// *** СПРАЙТЫ

// Начало спрайтовых тайлов
#define SPR_TILES ((u16 *) (VID_RAM_START + 0x10000))
// Структура описания спрайта
struct OAM_Entry
{
	u16 attr0, attr1, attr2, attr3;
};
// Массив описаний спрайтов (от 0 до 127)
#define SPR_BUFFER ((OAM_Entry *) (OAM_RAM_START))
// Выделим из массива спрайтов коэффициенты матриц
// вращения спрайтов в виде параметризированных
// макросов с параметрами от 0 до 31.
#define SPR_ROT_A( x ) (SPR_BUFFER[(x) * 4 + 0].attr3)
#define SPR_ROT_B( x ) (SPR_BUFFER[(x) * 4 + 1].attr3)
#define SPR_ROT_C( x ) (SPR_BUFFER[(x) * 4 + 2].attr3)
#define SPR_ROT_D( x ) (SPR_BUFFER[(x) * 4 + 3].attr3)
// БИТОВЫЕ ФЛАГИ АТРИБУТА 0:
// Биты 0-7: Координата Y спрайта
#define ATTR0_Y( y )		((y) & 255)
// Бит 8: Включить поворот/масштабирование
#define ATTR0_ROTATED		0x0100
// Бит 9 (1): Включить удвоение (только для ROTATED=1)
#define ATTR0_DOUBLED		0x0200
// Бит 9 (2): Отключить отображение спрайта (только для ROTATED=0)
#define ATTR0_DISABLED		0x0200
// Биты 10-11: Режим спрайта (один из трёх): обычный, прозрачный, маска окна.
#define ATTR0_MODE_NORMAL	0x0000
#define ATTR0_MODE_TRANSPARENT	0x0400
#define ATTR0_MODE_WINDOW	0x0800
// Бит 12: Включить мозаику
#define ATTR0_MOSAIC		0x1000
// Бит 13: 256-цветный режим (иначе 16-цветный)
#define ATTR0_COLOR_256		0x2000
// Бит 14-15: Форма спрайта (одна из трёх). Выбирает вариант формы спрайта, 
// которая в дальнейшем уточняется в параметре ATTR1.
// (SQ - квадратная, H - горизонтальная, V - вертикальная)
#define ATTR0_SHAPE_SQ		0x0000
#define ATTR0_SHAPE_H		0x4000
#define ATTR0_SHAPE_V		0x8000

// БИТОВЫЕ ФЛАГИ АТРИБУТА 1:
// Биты 0-8: Координата X спрайта
#define ATTR1_X( x )		((x) & 511)
// Биты 9-13 (только для ROTATED=1): Индекс матрицы поворота (от 0 до 31)
#define ATTR1_ROT_INDEX( x )	(((x) & 31) << 9)
// Бит 12 (только для ROTATED=0): Отзеркалить горизонтально
#define ATTR1_H_FLIP		0x1000
// Бит 13 (только для ROTATED=0): Отзеркалить вертикально
#define ATTR1_V_FLIP		0x2000
// Биты 14-15 (только при ATTR0_SHAPE_SQ): Размер спрайта в пикселях (один вариант)
#define ATTR1_SQ_8x8		0x0000
#define ATTR1_SQ_16x16		0x4000
#define ATTR1_SQ_32x32		0x8000
#define ATTR1_SQ_64x64		0xC000
// Биты 14-15 (только при ATTR0_SHAPE_H): Размер спрайта в пикселях (один вариант)
#define ATTR1_H_16x8		0x0000
#define ATTR1_H_32x8		0x4000
#define ATTR1_H_32x16		0x8000
#define ATTR1_H_64x32		0xC000
// Биты 14-15 (только при ATTR0_SHAPE_V): Размер спрайта в пикселях (один вариант)
#define ATTR1_V_8x16		0x0000
#define ATTR1_V_8x32		0x4000
#define ATTR1_V_16x32		0x8000
#define ATTR1_V_32x64		0xC000

// БИТОВЫЕ ФЛАГИ АТРИБУТА 2:
// Биты 0-9: Индекс тайла (в отличие от тайлов фонов индекс тайла в
// спрайте всегда ссылается байт 32*индекс от начала тайловых данных
// спрайтов, т.е. для 256-цветных следует указывать четные индексы.
#define ATTR2_TILE( x )		((x) & 1023)
// Биты 10-11: Приоритет (так же как у фонов от 0 до 3).
#define ATTR2_PRIORITY( x )	(((x) & 3) << 10)
// Биты 12-15 (только для 16-цветных): верхние 4 бита селектора палитры
#define ATTR2_PALETTE( x )	(((x) & 15) << 12)

// *** РЕГИСТРЫ ПИКСЕЛЬНЫХ СПЕЦ-ЭФФЕКТОВ

// *** Регистр управления режимом мозаики
#define REG_MOSAIC		(*((volatile u16 *) 0x400004C))
// (содержимое пока не описано...)

// *** Регистр управления альфа-прозрачностью, затенением и просветлением
#define REG_BLENDCNT		(*((volatile u16 *) 0x4000050))
// Флаги:
// Биты 0-5 - флаги что является источником для смешивания:
// BG0-BG3 - фоны, SPR - спрайты, BACK - задний фон.
#define BLEND_SRC_BG0		0x01
#define BLEND_SRC_BG1		0x02
#define BLEND_SRC_BG2		0x04
#define BLEND_SRC_BG3		0x08
#define BLEND_SRC_SPR		0x10
#define BLEND_SRC_BACK		0x20
// Биты 6-7 режим смешивания: OFF - выкл, BLEND - полупрозрачность, 
// LIGHT - просветление, DARK - затемнение.
#define BLEND_MODE_OFF		0x0000
#define BLEND_MODE_ALPHA	0x0040
#define BLEND_MODE_LIGHT	0x0080
#define BLEND_MODE_DARK		0x00C0
// Биты 8-13 - флаги что является целью для смешивания:
// BG0-BG3 - фоны, SPR - спрайты, BACK - задний фон.
#define BLEND_DEST_BG0		0x0100
#define BLEND_DEST_BG1		0x0200
#define BLEND_DEST_BG2		0x0400
#define BLEND_DEST_BG3		0x0800
#define BLEND_DEST_SPR		0x1000
#define BLEND_DEST_BACK		0x2000

// *** Регистр управления коэффициентами альфа-прозрачности
#define REG_BLENDALPHA		(*((volatile u16 *) 0x4000052))
#define BLEND_SRC_A( x )	(x)
#define BLEND_DEST_A( x )	((x) << 8)
// *** Регистр управления величиной затенения/просветления
#define REG_BLENDCOLY		(*((volatile u16 *) 0x4000054))

// ======================
// =       КНОПКИ       =
// ======================

// Регистр текущих нажатых кнопок (0 - нажато, 1 - отжато!)
#define REG_KEYS	(*((volatile u16 *) 0x04000130))
// Битовые маски кнопок в регистре
#define KEY_A		1
#define KEY_B		2
#define KEY_SELECT	4
#define KEY_START	8
#define KEY_RIGHT	16
#define KEY_LEFT	32
#define KEY_UP		64
#define KEY_DOWN	128
#define KEY_R		256
#define KEY_L		512

// Регистр управления кнопками
#define REG_KEYCNT	(*((volatile u16 *) 0x04000132))

// ======================
// =      ТАЙМЕРЫ       =
// ======================

// Регистры данных (D) и управления (CNT) соответствующими таймерами.
// Данные (D) по чтению возвращают текущее значение таймера, а по записи
// сохраняют начальное значение после его переполнения.
#define REG_TM0D	(*((volatile u16 *) 0x4000100))
#define REG_TM0CNT	(*((volatile u16 *) 0x4000102))
#define REG_TM1D	(*((volatile u16 *) 0x4000104))
#define REG_TM1CNT	(*((volatile u16 *) 0x4000106))
#define REG_TM2D	(*((volatile u16 *) 0x4000108))
#define REG_TM2CNT	(*((volatile u16 *) 0x400010A))
#define REG_TM3D	(*((volatile u16 *) 0x400010C))
#define REG_TM3CNT	(*((volatile u16 *) 0x400010E))

// Флаги регистров управления таймерами (CNT)
#define TIMER_FREQUENCY_SYSTEM  0x0
#define TIMER_FREQUENCY_64      0x1
#define TIMER_FREQUENCY_256     0x2
#define TIMER_FREQUENCY_1024    0x3
#define TIMER_OVERFLOW          0x4
#define TIMER_IRQ_ENABLE        0x40
#define TIMER_ENABLE            0x80

// ======================
// =     ПРЕРЫВАНИЯ     =
// ======================

// *** Регистр общего включения прерываний. Если 0-ой бит равен 0, то любые
// прерывания подавляются. Обработчику прерываний бывает полезно выключить
// прерывания первым действием и включить их обратно на выходе.
#define REG_IME			(*((volatile u16 *) 0x4000208))
// *** Регистр включения/выключения реакции ЦП на конкретные виды прерываний 
// (см. маски видов прерываний ниже)
// Обратите внимание, что кроме включения маски в REG_IE нужно еще всегда 
// включить генерацию прерывания в соответствующем управляющем порте 
// устройства-источника (например в REG_DISPSTAT для видеоадаптера).
#define REG_IE			(*((volatile u16 *) 0x4000200))
// *** Регистр текущего выполняемого прерывания. Несмотря на то, что здесь
// содержится такие же маски прерываний как в REG_IE, но только один битовый флаг
// взводится системой прежде чем входить в обработчик прерывания, два флага
// не богут быть одновременно включены. Обработчик прерывания должен
// сбросить флаг записью 1 (единицы!) в соответствующий бит на выходе.
#define REG_IF			(*((volatile u16 *) 0x4000202))
// Адрес процедуры обработки прерывания
typedef void (*intr_handler_type)(void);
#define REG_INTERRUPT		(*((volatile intr_handler_type *) 0x3007FFC))
// Маски видов прерываний в регистрах REG_IE и REG_IF
#define INT_VBLANK 0x0001
#define INT_HBLANK 0x0002
#define INT_VCOUNT 0x0004
#define INT_TIMER0 0x0008
#define INT_TIMER1 0x0010
#define INT_TIMER2 0x0020
#define INT_TIMER3 0x0040
#define INT_COM    0x0080
#define INT_DMA0   0x0100
#define INT_DMA1   0x0200
#define INT_DMA2   0x0400
#define INT_DMA3   0x0800
#define INT_BUTTON 0x1000
#define INT_CART   0x2000

// ======================
// =        DMA         =
// ======================

// *** Адрес источника (source)
// DMA0 не может адресовать выше ROM_START (остальные могут)
#define REG_DMA0SAD		(*((volatile u32 *) 0x40000b0))
#define REG_DMA1SAD		(*((volatile u32 *) 0x40000bc))
#define REG_DMA2SAD		(*((volatile u32 *) 0x40000c8))
#define REG_DMA3SAD		(*((volatile u32 *) 0x40000d4))

// *** Адрес приёмника (destination)
// DMA3 может адресовать выше ROM_START (остальные не могут!)
#define REG_DMA0DAD		(*((volatile u32 *) 0x40000b4))
#define REG_DMA1DAD		(*((volatile u32 *) 0x40000c0))
#define REG_DMA2DAD		(*((volatile u32 *) 0x40000cc))
#define REG_DMA3DAD		(*((volatile u32 *) 0x40000d8))

// *** Число элементов (16 или 32-битных) к передаче (count)
// Счётчик DMA3 16-битный, остальные 14-битные. Значение 0 
// соответствует "максимуму" (65536 для DMA3 и 16384 для остальных).
#define REG_DMA0CNT_L		(*((volatile u16 *) 0x40000b8))
#define REG_DMA1CNT_L		(*((volatile u16 *) 0x40000c4))
#define REG_DMA2CNT_L		(*((volatile u16 *) 0x40000d0))
#define REG_DMA3CNT_L		(*((volatile u16 *) 0x40000dc))

// *** Регистр управления каналом (см. флаги ниже)
#define REG_DMA0CNT_H		(*((volatile u16 *) 0x40000ba))
#define REG_DMA1CNT_H		(*((volatile u16 *) 0x40000c6))
#define REG_DMA2CNT_H		(*((volatile u16 *) 0x40000d2))
#define REG_DMA3CNT_H		(*((volatile u16 *) 0x40000de))

// *** Флаги регистров управления:
// Биты 5-6: режим шага адреса приёмника:
// INCR - увеличение, DECR - уменьшение, FIXED - фиксированный адрес,
// INCR_RELOAD - имеет смысл для режима автоповтора (REPEAT) -
//   DMA-контроллер при повторе будет перезагружать внутренний
//   адрес приёмника содержимым этого регистра.
#define DMA_DEST_INCR		0x0000
#define DMA_DEST_DECR		0x0020
#define DMA_DEST_FIXED		0x0040
#define DMA_DEST_INCR_RELOAD	0x0060
// Биты 7-8: режим шага адреса источника
// Нет опции аналогичной DEST_INCR_RELOAD!
#define DMA_SRC_INCR		0x0000
#define DMA_SRC_DECR		0x0080
#define DMA_SRC_FIXED		0x0100
// Бит 9: режим автоповтора
#define DMA_REPEAT		0x0200
// Бит 10: размер передаваемых элементов
#define DMA_16BIT		0x0000
#define DMA_32BIT		0x0400
// Бит 11: (только для DMA3) GamePack DRQ (?)
#define DMA_GAMEPACK_DRQ	0x0800
// Биты 12-13: момент запуска DMA-передачи:
// IMMEDIATE - сразу после перехода бита включения (DMA_ENABLE) из 0 в 1
// VBLANK    - при входе в VBlank
// HBLANK    - при входе в HBlank
// SPECIAL   - для DMA1 и DMA2 - "подпитывание" звуковых FIFO-буферов,
//             для DMA3 - видеозахват
#define DMA_START_IMMEDIATE	0x0000
#define DMA_START_VBLANK	0x1000
#define DMA_START_HBLANK	0x2000
#define DMA_START_SPECIAL	0x3000
// Бит 14: генерировать прерывание при завершении копирования
#define DMA_IRQ_ENABLE		0x4000
// Бит 15: бит включения DMA-канала
#define DMA_ENABLE		0x8000

// ======================
// =        ЗВУК        =
// ======================

// *** FIFO-буферы для двух каналов (A и B) DirectSound .
// 32-битные значения в портах FIFO_A и FIFO_B принимают четыре сампла
// (байты со знаком), при этом первыми проигрываются младшие байты.
// FIFO-буфера имеют размер 8 32-битных значений или 32 сампла (байта).
#define REG_FIFO_A_L		(*((volatile u16 *) 0x40000a0))
#define REG_FIFO_A_H		(*((volatile u16 *) 0x40000a2))
#define REG_FIFO_A		(*((volatile u32 *) 0x40000a0))
#define REG_FIFO_B_L		(*((volatile u16 *) 0x40000a4))
#define REG_FIFO_B_H		(*((volatile u16 *) 0x40000a6))
#define REG_FIFO_B		(*((volatile u32 *) 0x40000a4))

// *** Регистр общего управления PSG (осцилляторами)
// мной пока не используется и его флаги я не выписываю.
#define REG_SOUNDCNT_L		(*((volatile u16 *) 0x4000080))

// *** Регистр управления DirectSound и общей громкостью PSG.
#define REG_SOUNDCNT_H		(*((volatile u16 *) 0x4000082))
// Биты 0-1: громкость звуковых осцилляторов (PSG).
#define SOUND_PSG_VOL_25	0x0000
#define SOUND_PSG_VOL_50	0x0001
#define SOUND_PSG_VOL_100	0x0002
// Бит 2: громкость канала A (50% или 100%)
#define SOUND_A_VOL_50		0x0000
#define SOUND_A_VOL_100		0x0004
// Бит 3: громкость канала B (50% или 100%)
#define SOUND_B_VOL_50		0x0000
#define SOUND_B_VOL_100		0x0008
// Бит 8: вывод канала A в правый динамик
#define SOUND_A_RIGHT		0x0100
// Бит 9: вывод канала A в левый динамик
#define SOUND_A_LEFT		0x0200
// Бит 10: выбор подпитывающего таймера канала A (0-ой или 1-ый)
#define SOUND_A_TIMER0		0x0000
#define SOUND_A_TIMER1		0x0400
// Бит 11: при установке в 1 очищает FIFO-буфер
#define SOUND_A_RESET		0x0800
// Бит 12: вывод канала B в правый динамик
#define SOUND_B_RIGHT		0x1000
// Бит 13: вывод канала B в левый динамик
#define SOUND_B_LEFT		0x2000
// Бит 14: выбор подпитывающего таймера канала B (0-ой или 1-ый)
#define SOUND_B_TIMER0		0x0000
#define SOUND_B_TIMER1		0x4000
// Бит 15: при установке в 1 очищает FIFO-буфер
#define SOUND_B_RESET		0x8000

// *** Регистр статуса PSG и включения звукового чипа.
#define REG_SOUNDCNT_X		(*((volatile u16 *) 0x4000084))
// Биты 0-3: равны 1 пока соответствующий осциллятор (PSG)
// генерирует звук и сбрасываются в 0 когда они останавливаются.
// Биты 7: глобальный флаг включения/выключения звукового чипа.
#define SOUND_ENABLE		0x80

// ======================
// =       РАЗНОЕ       =
// ======================

// Макрос вызова процедуры из BIOS (системный вызов) без параметров
#if defined ( __thumb__ )
#define	SystemCall(N) __asm("SWI "#N"\n" ::: "r0","r1","r2","r3")
#else
#define	SystemCall(N) __asm("SWI "#N"<<16\n" ::: "r0","r1","r2","r3")
#endif

// Вызвать процедуру BIOS, которая останавливает процессор
// до наступления прерывания по VBlank. Прерывание VBlank должно
// и испускаться и перехватываться, а процедура обработки
// прерывания обязана на выходе при обновлении REG_IF наложить по битовому OR
// то же самое значение, что она в него записывает во флаг BIOS:
// BIOS_WAIT_FLAG |= value;
// Использование этой функции экономит потребление энергии процессором.
inline void VBlankIntrWait()	{ SystemCall( 5 ); };

// Флаг BIOS для обеспечения работы VBlankIntrWait() (и др., см. выше)
#define BIOS_WAIT_FLAG		(*((volatile u16 *) 0x3007FF8))

// "Барьер памяти" заставляет компилятор сохранить в память значения
// переменных (если они кешированы в регистрах) до барьера и не делать 
// предположений о содержимом памяти после барьера (то есть считать
// их кешированные значения в регистрах устаревшими). 
// Это позволяет оптимизатору не ломать логику программы с активным 
// использованием прерываний, выкидывая куски кода которые по его мнению 
// не производят полезных действий. 
// Этот барьер действует только на уровне компилятора, но не процессора!
// Барьеры памяти для процессора делаются инструкциями, но так как
// GBA является однопроцессорной системой, то в нём это не имеет
// никакого значения.
#define MEMORY_BARRIER		__asm volatile("": : :"memory")

#endif
