// Обёртка над ядром mGBA: загрузка ROM, кадр, состояние, память, звук, лог.
#pragma once
#include <cstdint>
#include <string>
#include <vector>

struct mCore;

namespace gbadbg {

// Кнопки GBA (биты как в KEYINPUT, но 1 = нажата)
enum GbaKey : uint32_t {
	KEY_A = 1 << 0, KEY_B = 1 << 1, KEY_SELECT = 1 << 2, KEY_START = 1 << 3,
	KEY_RIGHT = 1 << 4, KEY_LEFT = 1 << 5, KEY_UP = 1 << 6, KEY_DOWN = 1 << 7,
	KEY_R = 1 << 8, KEY_L = 1 << 9,
};

// Регионы памяти (номер = старший байт адреса, как REGION_* в mGBA)
enum Region : int {
	R_EWRAM = 2, R_IWRAM = 3, R_IO = 4, R_PAL = 5, R_VRAM = 6, R_OAM = 7, R_ROM = 8,
};
struct RegionInfo { Region id; const char* name; uint32_t base; uint32_t size; };
extern const RegionInfo kRegions[];      // EWRAM, IWRAM, PAL, VRAM, OAM
extern const int kRegionCount;

struct LogLine {
	uint32_t frame;
	int level;            // mLogLevel
	std::string cat;
	std::string text;
	int repeat = 1;       // одинаковые подряд строки схлопываются
	bool isError() const;
};

class Emu {
public:
	static const int W = 240, H = 160;

	bool load(const std::string& romPath, const std::string& savePath, std::string& err);
	void shutdown();

	// Один кадр. audio=false - звук выбрасываем (перемотка/повтор кадра)
	void runFrame(uint32_t keys, bool audio);

	size_t stateSize() const { return stateBytes; }
	void saveState(void* buf);
	bool loadState(const void* buf);

	// Прямой указатель на память региона (EWRAM/IWRAM/PAL/VRAM/OAM/ROM); nullptr - нет такого
	uint8_t* mem(Region r, size_t* size = nullptr);
	uint16_t io16(uint32_t offset);       // регистр ввода-вывода 0x04000000 + offset

	const uint32_t* pixels() const { return rgba.data(); }   // W*H, RGBA (A = 255)

	// Лог ядра (включая отладочный вывод игры через регистры mGBA 0x04FFF600)
	std::vector<LogLine> log;
	uint32_t curFrame = 0;          // номер кадра, который сейчас выполняется (для лога)
	bool replaying = false;         // повтор кадра при перемотке - лог не пишем
	bool errorInFrame = false;      // за кадр была ошибка (GAME_ERROR/ERROR/FATAL)
	void addLog(int level, const char* cat, const char* text);
	void trimLogAfter(uint32_t frame);   // при продолжении с прошлого кадра «будущее» стирается

	bool muted = false;
	float volume = 0.7f;

	mCore* core = nullptr;

private:
	void pumpAudio(bool play);

	std::vector<uint32_t> video;    // 256 * 160, как отдаёт mGBA (stride 256)
	std::vector<uint32_t> rgba;     // 240 * 160
	size_t stateBytes = 0;
	std::vector<uint8_t> romData, saveData;
	unsigned audioDev = 0;
	int audioRate = 48000;
	std::vector<int16_t> audioBuf;
};

} // namespace gbadbg
