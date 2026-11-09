#include "emu.h"

#include <SDL.h>
#include <cstdarg>
#include <cstdio>
#include <cstring>
#include <fstream>
#include <iterator>

#include <mgba/core/blip_buf.h>
#include <mgba/core/core.h>
#include <mgba/core/log.h>
#include <mgba-util/vfs.h>

namespace gbadbg {

const RegionInfo kRegions[] = {
	{ R_EWRAM, "EWRAM",   0x02000000, 0x40000 },
	{ R_IWRAM, "IWRAM",   0x03000000, 0x8000 },
	{ R_PAL,   "Palette", 0x05000000, 0x400 },
	{ R_VRAM,  "VRAM",    0x06000000, 0x18000 },
	{ R_OAM,   "OAM",     0x07000000, 0x400 },
};
const int kRegionCount = sizeof(kRegions) / sizeof(kRegions[0]);

bool LogLine::isError() const {
	return level & (mLOG_FATAL | mLOG_ERROR | mLOG_GAME_ERROR);
}

// ---------------- лог mGBA -> Emu::log ----------------
static Emu* g_emu = nullptr;

static void logCallback(struct mLogger*, int category, enum mLogLevel level, const char* format, va_list args) {
	if (!g_emu) return;
	if (g_emu->errorHook && (level & (mLOG_FATAL | mLOG_ERROR | mLOG_GAME_ERROR))) {
		char t[512];
		va_list c;
		va_copy(c, args);
		vsnprintf(t, sizeof(t), format, c);
		va_end(c);
		g_emu->errorHook(level, t);
	}
	if (g_emu->replaying) return;
	const char* cat = mLogCategoryName(category);
	const bool gameDebug = cat && !strcmp(cat, "GBA Debug");   // вывод самой игры (регистры 0x04FFF600)
	// DEBUG/STUB ядра - шум (SWI и т.п.), их не храним
	if (!gameDebug && (level & (mLOG_DEBUG | mLOG_STUB))) return;
	char text[512];
	vsnprintf(text, sizeof(text), format, args);
	g_emu->addLog(level, cat ? cat : "?", text);
}
static struct mLogger g_logger = { logCallback, nullptr };

void Emu::addLog(int level, const char* cat, const char* text) {
	if (level & (mLOG_FATAL | mLOG_ERROR | mLOG_GAME_ERROR)) errorInFrame = true;
	if (!log.empty()) {
		LogLine& l = log.back();
		if (l.frame == curFrame && l.level == level && l.text == text) { l.repeat++; return; }
	}
	if (log.size() > 50000) log.erase(log.begin(), log.begin() + 10000);
	log.push_back({ curFrame, level, cat, text });
}

void Emu::trimLogAfter(uint32_t frame) {
	while (!log.empty() && log.back().frame > frame) log.pop_back();
}

// ---------------- загрузка ----------------
static bool readFile(const std::string& path, std::vector<uint8_t>& out) {
	std::ifstream f(path, std::ios::binary);
	if (!f) return false;
	out.assign(std::istreambuf_iterator<char>(f), std::istreambuf_iterator<char>());
	return true;
}

bool Emu::load(const std::string& romPath, const std::string& savePath, std::string& err) {
	g_emu = this;
	mLogSetDefaultLogger(&g_logger);

	if (!readFile(romPath, romData) || romData.empty()) { err = "cannot read ROM: " + romPath; return false; }
	struct VFile* rom = VFileMemChunk(romData.data(), romData.size());
	core = mCoreFindVF(rom);
	if (!core) { err = "mGBA does not recognise the ROM"; rom->close(rom); return false; }
	if (!core->init(core)) { err = "core init failed"; return false; }

	video.assign(256 * H, 0);
	rgba.assign(W * H, 0xFF000000);
	core->setVideoBuffer(core, (color_t*)video.data(), 256);

	if (!core->loadROM(core, rom)) { err = "loadROM failed"; return false; }

	// Сохранение: копия в памяти (loadTemporarySave) - файл .sav на диске отладчик НЕ меняет
	if (!savePath.empty() && readFile(savePath, saveData) && !saveData.empty()) {
		core->loadTemporarySave(core, VFileMemChunk(saveData.data(), saveData.size()));
	} else {
		core->loadTemporarySave(core, VFileMemChunk(nullptr, 0));
	}

	mCoreInitConfig(core, "gbadbg");
	// без значения по умолчанию opts.volume = 0 -> ядро выдаёт тишину (mGBA берёт громкость из конфига)
	mCoreConfigSetDefaultIntValue(&core->config, "volume", 0x100);
	mCoreLoadConfig(core);
	core->setAudioBufferSize(core, 4096);
	core->reset(core);
	stateBytes = core->stateSize(core);

	// Звук: SDL-очередь, ресемплинг делает blip_buf ядра
	SDL_AudioSpec want{}, have{};
	want.freq = 48000;
	want.format = AUDIO_S16SYS;
	want.channels = 2;
	want.samples = 1024;
	audioDev = SDL_OpenAudioDevice(nullptr, 0, &want, &have, 0);
	if (audioDev) {
		audioRate = have.freq;
		blip_set_rates(core->getAudioChannel(core, 0), core->frequency(core), audioRate);
		blip_set_rates(core->getAudioChannel(core, 1), core->frequency(core), audioRate);
		SDL_PauseAudioDevice(audioDev, 0);
	}
	return true;
}

void Emu::shutdown() {
	if (audioDev) SDL_CloseAudioDevice(audioDev);
	audioDev = 0;
	if (core) {
		mCoreConfigDeinit(&core->config);
		core->deinit(core);
	}
	core = nullptr;
}

// ---------------- кадр ----------------
void Emu::runFrame(uint32_t keys, bool audio) {
	beginFrame(keys);
	core->runFrame(core);
	endFrame(audio);
}

void Emu::beginFrame(uint32_t keys) {
	errorInFrame = false;
	core->setKeys(core, keys);
}

void Emu::endFrame(bool audio) {
	for (int y = 0; y < H; y++) {
		const uint32_t* s = &video[y * 256];
		uint32_t* d = &rgba[y * W];
		for (int x = 0; x < W; x++) d[x] = s[x] | 0xFF000000u;   // mGBA: байты R,G,B,x
	}
	pumpAudio(audio && !muted);
}

void Emu::pumpAudio(bool play) {
	blip_t* l = core->getAudioChannel(core, 0);
	blip_t* r = core->getAudioChannel(core, 1);
	const int n = blip_samples_avail(l);
	if (!play || !audioDev || n <= 0) { blip_clear(l); blip_clear(r); return; }
	audioBuf.resize(n * 2);
	blip_read_samples(l, audioBuf.data(), n, 1);
	blip_read_samples(r, audioBuf.data() + 1, n, 1);
	if (volume < 0.999f)
		for (auto& s : audioBuf) s = (int16_t)(s * volume);
	// не копим задержку: больше ~0.15 с в очереди - этот кусок выбрасываем (ускорение и т.п.)
	if (SDL_GetQueuedAudioSize(audioDev) < (Uint32)(audioRate * 4 * 15 / 100))
		SDL_QueueAudio(audioDev, audioBuf.data(), (Uint32)(audioBuf.size() * 2));
}

// ---------------- состояние и память ----------------
void Emu::saveState(void* buf) { core->saveState(core, buf); }
bool Emu::loadState(const void* buf) {
	// GBADeserialize перезаписывает регистры DMA, и mGBA на выключенных каналах (источник 0) пишет
	// «Invalid DMA source address: 0x00000000» - это не ошибка игры, в лог не берём
	const bool r = replaying;
	auto hook = std::move(errorHook);
	replaying = true;
	errorHook = nullptr;
	const bool ok = core->loadState(core, buf);
	replaying = r;
	errorHook = std::move(hook);
	return ok;
}

uint8_t* Emu::mem(Region r, size_t* size) {
	size_t s = 0;
	void* p = core->getMemoryBlock(core, (size_t)r, &s);
	if (size) *size = s;
	return (uint8_t*)p;
}

uint16_t Emu::io16(uint32_t offset) {
	return (uint16_t)core->rawRead16(core, 0x04000000 + offset, -1);
}

} // namespace gbadbg
