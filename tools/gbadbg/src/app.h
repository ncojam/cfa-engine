// Состояние отладчика: эмулятор, история, трассировка, символы, что показываем.
#pragma once
#include <cstdint>
#include <deque>
#include <map>
#include <set>
#include <string>
#include <vector>

#include "emu.h"
#include "history.h"
#include "symbols.h"
#include "tracer.h"
#include "views.h"

namespace gbadbg {

static const double kFrameSec = 280896.0 / 16777216.0;   // кадр GBA ~16.74 мс (59.73 Гц)

struct Activity { uint32_t frame; int fn; int caller; };

struct App {
	Emu emu;
	History hist;
	Views views;
	FrameDiff diff;
	Symbols syms;
	Tracer tracer{ syms };
	Trace trace;                  // последняя трассировка (живая или показанного кадра)

	bool paused = false;
	int64_t view = -1;            // кадр на экране (результат его выполнения)
	bool pauseOnError = true;
	bool autoDiff = true;
	bool liveTrace = false;       // трассировать каждый кадр во время игры (лента активности)
	bool autoTrace = true;        // на паузе трассировать показанный кадр
	int budgetMB = 1024;
	std::map<uint32_t, std::string> marks;
	std::vector<uint32_t> errorFrames;
	char markNote[128] = "";
	std::string pauseReason;                 // почему стоим на паузе (показывается над экраном игры)
	std::set<std::string> seenErrors;        // виды ошибок, на которых уже останавливались

	// лента: функции, которые начали вызываться (не вызывались последние activityGap кадров)
	std::deque<Activity> feed;
	std::vector<uint32_t> lastSeen;
	int activityGap = 120;

	// окно исходника
	int srcFile = -1, srcLine = 0;
	uint32_t srcAddr = 0;
	bool srcScroll = false;
	bool srcFollow = true;

	bool hasSymbols() const { return syms.loaded(); }

	void stepLive(uint32_t keys);
	void seek(int64_t f);
	void traceView(uint32_t watchAddr = 0, uint32_t watchLen = 0);
	void pause();
	void resume();
	void step(int delta, uint32_t liveKeys);
	void computeDiff();
	void toggleMark();
	void showAddr(uint32_t addr);   // исходник по адресу кода
	void showFunc(int fn);

private:
	void runShown(uint32_t f, bool record, uint32_t keys, uint32_t watchAddr = 0, uint32_t watchLen = 0);
	void updateFeed(uint32_t f);
	std::vector<uint8_t> tmp, cur;
};

// окна (ui.cpp)
void timelineWindow(App& a, uint32_t liveKeys);
void logWindow(App& a);
void traceWindow(App& a);
void sourceWindow(App& a);
void activityWindow(App& a);

} // namespace gbadbg
