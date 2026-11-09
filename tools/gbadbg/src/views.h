// Панели просмотра: экран игры, тайлы VRAM, спрайты (OAM), палитры, изменения памяти, hex.
#pragma once
#include <cstdint>
#include <functional>
#include <string>
#include <vector>

#include "emu.h"

struct ImVec2;

namespace gbadbg {

class Symbols;

// Текстура OpenGL под картинку RGBA
struct Tex {
	unsigned id = 0;
	int w = 0, h = 0;
	void upload(const uint32_t* rgba, int w, int h);
	void* imguiId() const { return (void*)(intptr_t)id; }
};

// Что изменилось в памяти за кадр (сравнение «до кадра» и «после кадра»)
struct RegionDiff {
	RegionInfo info;
	std::vector<uint8_t> before, after;
	std::vector<std::pair<uint32_t, uint32_t>> ranges;   // [смещение, длина], близкие склеены
	size_t changed = 0;
};
struct FrameDiff {
	int64_t frame = -1;          // для какого кадра посчитано (-1 - нет)
	std::vector<RegionDiff> regions;
	void compute(int64_t frame);  // заполнить ranges/changed по before/after
};

class Views {
public:
	void beforeFrame(Emu& emu);   // вызывать перед каждым выполнением кадра (подсветка изменённых тайлов)

	void gameWindow(Emu& emu, float scale);
	void tilesWindow(Emu& emu);
	void spritesWindow(Emu& emu);
	void paletteWindow(Emu& emu);
	void diffWindow(Emu& emu, FrameDiff& diff);
	void memoryWindow(Emu& emu, const FrameDiff& diff);

	Symbols* syms = nullptr;                                   // имена переменных для адресов
	std::function<void(uint32_t addr, uint32_t len)> whoWrote;  // «кто записал» - трассировка показанного кадра

	// перейти в hex-просмотре к адресу (из окна изменений)
	void gotoAddress(uint32_t addr) { memGoto = addr; memGotoPending = true; }

private:
	uint32_t bgr555(const uint8_t* pal, int index) const;

	Tex gameTex, tilesTex, spriteAtlas;
	std::vector<uint8_t> prevVram;
	std::vector<uint32_t> img;

	// тайлы
	int tileSection = 0;   // 0 OBJ, 1 весь BG, 2..5 charblock 0..3
	bool tile8bpp = true;
	int tilesPerRow = 16;
	int tileScale = 2;
	int palBank = 0;
	bool tileChecker = true;
	bool tileChanged = true;
	bool tileGrid = false;

	// спрайты
	bool spritesVisibleOnly = true;
	bool spriteBoxesAll = false;
	int hoveredSprite = -1;

	// hex
	int memRegion = 0;
	uint32_t memGoto = 0;
	bool memGotoPending = false;
	int diffSel = -1, diffRangeSel = -1;
};

} // namespace gbadbg
