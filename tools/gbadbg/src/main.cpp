// gbadbg - отладчик Graveblood: mGBA + перемотка по кадрам + просмотр графики и памяти.
//
//   gbadbg graveblood.gba [--save graveblood.sav] [--history-mb 1024]
//
// Управление игрой (как в mGBA): стрелки, X = A, Z = B, A = L, S = R, Enter = Start, Backspace = Select.
// Отладка: Space - пауза/продолжить, ',' / '.' - кадр назад/вперёд (Shift - по 10),
//          Tab (держать) - ускорение, M - пометить кадр как плохой.
#include <SDL.h>
#include <SDL_opengl.h>

#include <algorithm>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <filesystem>
#include <map>
#include <string>
#include <vector>

#include "imgui.h"
#include "imgui_impl_opengl3.h"
#include "imgui_impl_sdl2.h"
#include "imgui_internal.h"   // DockBuilder

#include "emu.h"
#include "history.h"
#include "views.h"

using namespace gbadbg;

static const double kFrameSec = 280896.0 / 16777216.0;   // кадр GBA ~16.74 мс (59.73 Гц)

struct App {
	Emu emu;
	History hist;
	Views views;
	FrameDiff diff;

	bool paused = false;
	int64_t view = -1;            // кадр, который сейчас на экране (результат его выполнения)
	bool pauseOnError = true;
	bool autoDiff = true;
	int budgetMB = 1024;
	std::map<uint32_t, std::string> marks;   // «плохие» кадры с заметкой
	std::vector<uint32_t> errorFrames;       // кадры с ошибками ядра (по возрастанию)
	char markNote[128] = "";
	std::vector<uint8_t> tmp, cur;

	void stepLive(uint32_t keys) {
		const uint32_t f = hist.empty() ? 0 : hist.end();
		tmp.resize(emu.stateSize());
		emu.saveState(tmp.data());
		hist.record(f, tmp.data(), keys);
		views.beforeFrame(emu);
		emu.curFrame = f;
		emu.runFrame(keys, true);
		view = f;
		if (emu.errorInFrame) {
			hist.setFlag(f, FF_ERROR, true);
			errorFrames.push_back(f);
			if (pauseOnError) pause();
		}
	}

	// Показать кадр f: предсостояние f + кнопки f -> выполнить кадр (без звука и без записи в лог)
	void seek(int64_t f) {
		if (hist.empty()) return;
		f = std::clamp<int64_t>(f, hist.first(), hist.end() - 1);
		if (!hist.reconstruct((uint32_t)f, tmp)) return;
		emu.loadState(tmp.data());
		views.beforeFrame(emu);
		emu.replaying = true;
		emu.curFrame = (uint32_t)f;
		emu.runFrame(hist.keys((uint32_t)f), false);
		emu.replaying = false;
		view = f;
		if (autoDiff) computeDiff();
	}

	void pause() {
		paused = true;
		if (autoDiff) computeDiff();
	}

	// Продолжить с показанного кадра: всё, что было записано после него, стирается
	void resume() {
		if (view >= 0 && !hist.empty() && view < (int64_t)hist.end() - 1) {
			hist.truncateAfter((uint32_t)view);
			emu.trimLogAfter((uint32_t)view);
			while (!errorFrames.empty() && errorFrames.back() > view) errorFrames.pop_back();
			for (auto it = marks.begin(); it != marks.end();) it = it->first > view ? marks.erase(it) : std::next(it);
		}
		paused = false;
		diff.frame = -1;
	}

	void step(int delta, uint32_t liveKeys) {
		if (!paused) pause();
		if (delta > 0) {
			for (int i = 0; i < delta; i++) {
				if (view + 1 < (int64_t)hist.end()) { seek(view + 1); continue; }
				stepLive(liveKeys);   // конец истории - эмулируем новый кадр
			}
			if (autoDiff) computeDiff();
		} else {
			seek(view + delta);
		}
	}

	// Память до кадра view (его предсостояние) и после (текущее состояние ядра)
	void computeDiff() {
		if (view < 0 || !hist.has((uint32_t)view)) { diff.frame = -1; return; }
		cur.resize(emu.stateSize());
		emu.saveState(cur.data());
		hist.reconstruct((uint32_t)view, tmp);
		diff.regions.assign(kRegionCount, RegionDiff{});
		emu.loadState(tmp.data());
		for (int i = 0; i < kRegionCount; i++) {
			size_t s = 0;
			const uint8_t* m = emu.mem(kRegions[i].id, &s);
			diff.regions[i].info = kRegions[i];
			if (m) diff.regions[i].before.assign(m, m + std::min<size_t>(s, kRegions[i].size));
		}
		emu.loadState(cur.data());
		for (int i = 0; i < kRegionCount; i++) {
			size_t s = 0;
			const uint8_t* m = emu.mem(kRegions[i].id, &s);
			if (m) diff.regions[i].after.assign(m, m + std::min<size_t>(s, kRegions[i].size));
		}
		diff.compute(view);
	}

	void toggleMark() {
		if (view < 0) return;
		const uint32_t f = (uint32_t)view;
		if (marks.count(f)) { marks.erase(f); hist.setFlag(f, FF_BAD, false); }
		else { marks[f] = markNote; hist.setFlag(f, FF_BAD, true); markNote[0] = 0; }
	}
};

static uint32_t readGbaKeys() {
	const Uint8* k = SDL_GetKeyboardState(nullptr);
	uint32_t m = 0;
	if (k[SDL_SCANCODE_X]) m |= KEY_A;
	if (k[SDL_SCANCODE_Z]) m |= KEY_B;
	if (k[SDL_SCANCODE_A]) m |= KEY_L;
	if (k[SDL_SCANCODE_S]) m |= KEY_R;
	if (k[SDL_SCANCODE_RETURN]) m |= KEY_START;
	if (k[SDL_SCANCODE_BACKSPACE]) m |= KEY_SELECT;
	if (k[SDL_SCANCODE_UP]) m |= KEY_UP;
	if (k[SDL_SCANCODE_DOWN]) m |= KEY_DOWN;
	if (k[SDL_SCANCODE_LEFT]) m |= KEY_LEFT;
	if (k[SDL_SCANCODE_RIGHT]) m |= KEY_RIGHT;
	return m;
}

static void buildLayout(ImGuiID dock) {
	ImGui::DockBuilderRemoveNode(dock);
	ImGui::DockBuilderAddNode(dock, ImGuiDockNodeFlags_DockSpace);
	ImGui::DockBuilderSetNodeSize(dock, ImGui::GetMainViewport()->WorkSize);
	ImGuiID left, rest, mid, right, leftTop, leftBot;
	ImGui::DockBuilderSplitNode(dock, ImGuiDir_Left, 0.46f, &left, &rest);
	ImGui::DockBuilderSplitNode(rest, ImGuiDir_Left, 0.42f, &mid, &right);
	ImGui::DockBuilderSplitNode(left, ImGuiDir_Up, 0.60f, &leftTop, &leftBot);
	ImGui::DockBuilderDockWindow("Game", leftTop);
	ImGui::DockBuilderDockWindow("Timeline", leftBot);
	ImGui::DockBuilderDockWindow("Log", leftBot);
	ImGui::DockBuilderDockWindow("Tiles", mid);
	ImGui::DockBuilderDockWindow("Sprites", right);
	ImGui::DockBuilderDockWindow("Frame diff", right);
	ImGui::DockBuilderDockWindow("Memory", right);
	ImGui::DockBuilderDockWindow("Palette", right);
	ImGui::DockBuilderFinish(dock);
}

// Полоса таймлайна: ошибки (красные), плохие кадры (оранжевые), курсор (белый). Клик/перетаскивание - перемотка.
static void timelineBar(App& a) {
	const float w = ImGui::GetContentRegionAvail().x, h = 26;
	const ImVec2 p0 = ImGui::GetCursorScreenPos();
	ImGui::InvisibleButton("bar", ImVec2(w, h));
	ImDrawList* dl = ImGui::GetWindowDrawList();
	dl->AddRectFilled(p0, ImVec2(p0.x + w, p0.y + h), IM_COL32(40, 40, 48, 255));
	if (a.hist.empty()) return;
	const double first = a.hist.first(), last = a.hist.end() - 1;
	const double span = std::max(1.0, last - first);
	auto X = [&](double f) { return p0.x + (float)((f - first) / span * (w - 1)); };
	int n = 0;
	for (uint32_t f : a.errorFrames)
		if (f >= first && n++ < 4000) dl->AddLine(ImVec2(X(f), p0.y), ImVec2(X(f), p0.y + h), IM_COL32(230, 50, 50, 255));
	for (auto& m : a.marks)
		if (m.first >= first) dl->AddRectFilled(ImVec2(X(m.first) - 1, p0.y), ImVec2(X(m.first) + 2, p0.y + h), IM_COL32(255, 160, 0, 255));
	if (a.view >= 0) dl->AddLine(ImVec2(X((double)a.view), p0.y - 2), ImVec2(X((double)a.view), p0.y + h + 2), IM_COL32(255, 255, 255, 255), 2);
	if (ImGui::IsItemActive()) {
		const float mx = std::clamp(ImGui::GetIO().MousePos.x - p0.x, 0.f, w - 1);
		const int64_t f = (int64_t)(first + mx / (w - 1) * span + 0.5);
		if (!a.paused) a.pause();
		if (f != a.view) a.seek(f);
	}
	if (ImGui::IsItemHovered()) {
		const float mx = std::clamp(ImGui::GetIO().MousePos.x - p0.x, 0.f, w - 1);
		ImGui::SetTooltip("frame %lld", (long long)(first + mx / (w - 1) * span + 0.5));
	}
}

static void timelineWindow(App& a, uint32_t liveKeys) {
	ImGui::Begin("Timeline");
	if (ImGui::Button(a.paused ? "Resume (Space)" : "Pause (Space)", ImVec2(130, 0))) { if (a.paused) a.resume(); else a.pause(); }
	ImGui::SameLine(); if (ImGui::Button("|<")) { a.pause(); a.seek(a.hist.first()); }
	ImGui::SameLine(); if (ImGui::Button("-10")) a.step(-10, liveKeys);
	ImGui::SameLine(); if (ImGui::Button("-1")) a.step(-1, liveKeys);
	ImGui::SameLine(); if (ImGui::Button("+1")) a.step(1, liveKeys);
	ImGui::SameLine(); if (ImGui::Button("+10")) a.step(10, liveKeys);
	ImGui::SameLine(); if (ImGui::Button(">|")) { a.pause(); a.seek((int64_t)a.hist.end() - 1); }

	const uint32_t first = a.hist.first(), last = a.hist.empty() ? 0 : a.hist.end() - 1;
	ImGui::Text("frame %lld   history %u..%u (%.1f s)   %.1f / %d MB", (long long)a.view, first, last,
		(last - first) * kFrameSec, a.hist.bytes() / 1048576.0, a.budgetMB);
	if (a.paused && a.view >= 0 && a.view < (int64_t)last)
		ImGui::TextColored(ImVec4(1, 0.7f, 0.2f, 1), "Resume will continue from frame %lld and drop %u later frames",
			(long long)a.view, (uint32_t)(last - a.view));
	timelineBar(a);

	ImGui::Checkbox("pause on error", &a.pauseOnError);
	ImGui::SameLine(); ImGui::Checkbox("frame diff on pause", &a.autoDiff);
	ImGui::SameLine(); ImGui::SetNextItemWidth(150);
	if (ImGui::SliderInt("history MB", &a.budgetMB, 64, 8192)) a.hist.setBudget((size_t)a.budgetMB << 20);

	ImGui::SeparatorText("Bad frames (M)");
	ImGui::SetNextItemWidth(300);
	ImGui::InputTextWithHint("##note", "what looks wrong (optional)", a.markNote, sizeof(a.markNote));
	ImGui::SameLine();
	if (ImGui::Button(a.view >= 0 && a.marks.count((uint32_t)a.view) ? "Unmark frame" : "Mark frame as bad")) a.toggleMark();
	for (auto it = a.marks.begin(); it != a.marks.end();) {
		ImGui::PushID((int)it->first);
		const uint32_t f = it->first;
		if (ImGui::SmallButton("go")) { a.pause(); a.seek(f); }
		ImGui::SameLine(); ImGui::Text("%u  %s", f, it->second.c_str());
		ImGui::SameLine();
		const bool del = ImGui::SmallButton("x");
		ImGui::PopID();
		if (del) { a.hist.setFlag(f, FF_BAD, false); it = a.marks.erase(it); } else ++it;
	}

	ImGui::SeparatorText("Error frames");
	if (a.errorFrames.empty()) ImGui::TextDisabled("none");
	int shown = 0;
	for (auto it = a.errorFrames.rbegin(); it != a.errorFrames.rend() && shown < 50; ++it) {
		if (*it < first) break;
		ImGui::PushID((int)*it);
		if (ImGui::SmallButton("go")) { a.pause(); a.seek(*it); }
		ImGui::SameLine();
		const char* text = "";
		for (auto l = a.emu.log.rbegin(); l != a.emu.log.rend(); ++l)
			if (l->frame == *it && l->isError()) { text = l->text.c_str(); break; }
		ImGui::Text("%u  %s", *it, text);
		ImGui::PopID();
		shown++;
	}

	if (ImGui::CollapsingHeader("Keys")) {
		ImGui::TextUnformatted(
			"Game: arrows, X = A, Z = B, A = L, S = R, Enter = Start, Backspace = Select\n"
			"Space: pause / resume      , and . : frame back / forward (Shift: 10)\n"
			"Tab (hold): fast forward    M: mark shown frame as bad\n"
			"Paused on frame N: picture and memory = state AFTER frame N;\n"
			"'Frame diff' = what frame N changed; Tiles red boxes = tiles written during frame N.");
	}
	ImGui::End();
}

static void logWindow(App& a) {
	ImGui::Begin("Log");
	static bool errorsOnly = false, follow = true;
	static char filter[64] = "";
	ImGui::Checkbox("errors only", &errorsOnly);
	ImGui::SameLine(); ImGui::Checkbox("follow", &follow);
	ImGui::SameLine(); ImGui::SetNextItemWidth(200);
	ImGui::InputTextWithHint("##flt", "filter", filter, sizeof(filter));
	ImGui::SameLine(); if (ImGui::SmallButton("clear")) a.emu.log.clear();

	ImGui::BeginChild("lines", ImVec2(0, 0), 0, ImGuiWindowFlags_HorizontalScrollbar);
	std::vector<int> idx;
	idx.reserve(a.emu.log.size());
	for (int i = 0; i < (int)a.emu.log.size(); i++) {
		const LogLine& l = a.emu.log[i];
		if (errorsOnly && !l.isError()) continue;
		if (filter[0] && l.text.find(filter) == std::string::npos && l.cat.find(filter) == std::string::npos) continue;
		idx.push_back(i);
	}
	ImGuiListClipper clip;
	clip.Begin((int)idx.size());
	while (clip.Step())
		for (int k = clip.DisplayStart; k < clip.DisplayEnd; k++) {
			const LogLine& l = a.emu.log[idx[k]];
			char buf[700];
			if (l.repeat > 1) snprintf(buf, sizeof(buf), "%7u  %-11s %s  (x%d)##%d", l.frame, l.cat.c_str(), l.text.c_str(), l.repeat, idx[k]);
			else snprintf(buf, sizeof(buf), "%7u  %-11s %s##%d", l.frame, l.cat.c_str(), l.text.c_str(), idx[k]);
			const bool sel = a.view == (int64_t)l.frame;
			if (l.isError()) ImGui::PushStyleColor(ImGuiCol_Text, IM_COL32(255, 110, 110, 255));
			if (ImGui::Selectable(buf, sel)) { a.pause(); a.seek(l.frame); }
			if (l.isError()) ImGui::PopStyleColor();
		}
	if (follow && !a.paused) ImGui::SetScrollHereY(1.0f);
	ImGui::EndChild();
	ImGui::End();
}

static std::string configPath() {
	const char* x = getenv("XDG_CONFIG_HOME");
	const char* h = getenv("HOME");
	std::filesystem::path p = x && *x ? std::filesystem::path(x) : std::filesystem::path(h ? h : ".") / ".config";
	p /= "gbadbg";
	std::error_code ec;
	std::filesystem::create_directories(p, ec);
	return (p / "layout.ini").string();
}

int main(int argc, char** argv) {
	std::string rom, save;
	int historyMB = 1024;
	for (int i = 1; i < argc; i++) {
		const std::string s = argv[i];
		if (s == "--save" && i + 1 < argc) save = argv[++i];
		else if (s == "--history-mb" && i + 1 < argc) historyMB = atoi(argv[++i]);
		else if (s == "-h" || s == "--help") rom.clear(), i = argc;
		else rom = s;
	}
	if (rom.empty()) {
		fprintf(stderr, "usage: gbadbg game.gba [--save game.sav] [--history-mb 1024]\n");
		return 1;
	}
	if (save.empty()) {
		std::filesystem::path p(rom);
		p.replace_extension(".sav");
		if (std::filesystem::exists(p)) save = p.string();
	}

	if (SDL_Init(SDL_INIT_VIDEO | SDL_INIT_AUDIO | SDL_INIT_TIMER) != 0) {
		fprintf(stderr, "SDL_Init: %s\n", SDL_GetError());
		return 1;
	}
	SDL_GL_SetAttribute(SDL_GL_CONTEXT_MAJOR_VERSION, 3);
	SDL_GL_SetAttribute(SDL_GL_CONTEXT_MINOR_VERSION, 0);
	SDL_GL_SetAttribute(SDL_GL_DOUBLEBUFFER, 1);
	const std::string title = "gbadbg - " + std::filesystem::path(rom).filename().string();
	SDL_Window* win = SDL_CreateWindow(title.c_str(), SDL_WINDOWPOS_CENTERED, SDL_WINDOWPOS_CENTERED, 1800, 1000,
		SDL_WINDOW_OPENGL | SDL_WINDOW_RESIZABLE | SDL_WINDOW_ALLOW_HIGHDPI);
	if (!win) { fprintf(stderr, "SDL_CreateWindow: %s\n", SDL_GetError()); return 1; }
	SDL_GLContext gl = SDL_GL_CreateContext(win);
	SDL_GL_MakeCurrent(win, gl);
	SDL_GL_SetSwapInterval(1);

	IMGUI_CHECKVERSION();
	ImGui::CreateContext();
	ImGuiIO& io = ImGui::GetIO();
	io.ConfigFlags |= ImGuiConfigFlags_DockingEnable;
	static std::string ini = configPath();
	io.IniFilename = ini.c_str();
	ImGui::StyleColorsDark();
	ImGui_ImplSDL2_InitForOpenGL(win, gl);
	ImGui_ImplOpenGL3_Init("#version 130");

	App app;
	std::string err;
	if (!app.emu.load(rom, save, err)) {
		fprintf(stderr, "gbadbg: %s\n", err.c_str());
		return 1;
	}
	app.budgetMB = historyMB;
	app.hist.init(app.emu.stateSize(), (size_t)historyMB << 20);
	printf("gbadbg: %s, save %s, state %zu bytes\n", rom.c_str(), save.empty() ? "(none)" : save.c_str(), app.emu.stateSize());

	double acc = 0;
	Uint64 prev = SDL_GetPerformanceCounter();
	bool running = true;
	while (running) {
		SDL_Event e;
		while (SDL_PollEvent(&e)) {
			ImGui_ImplSDL2_ProcessEvent(&e);
			if (e.type == SDL_QUIT) running = false;
			if (e.type == SDL_WINDOWEVENT && e.window.event == SDL_WINDOWEVENT_CLOSE && e.window.windowID == SDL_GetWindowID(win)) running = false;
		}
		ImGui_ImplOpenGL3_NewFrame();
		ImGui_ImplSDL2_NewFrame();
		ImGui::NewFrame();

		const bool typing = io.WantTextInput;
		const uint32_t keys = typing ? 0 : readGbaKeys();
		bool fast = false;
		if (!typing) {
			const int stepN = io.KeyShift ? 10 : 1;
			if (ImGui::IsKeyPressed(ImGuiKey_Space, false)) { if (app.paused) app.resume(); else app.pause(); }
			if (ImGui::IsKeyPressed(ImGuiKey_Comma)) app.step(-stepN, keys);
			if (ImGui::IsKeyPressed(ImGuiKey_Period)) app.step(stepN, keys);
			if (ImGui::IsKeyPressed(ImGuiKey_M, false)) app.toggleMark();
			fast = ImGui::IsKeyDown(ImGuiKey_Tab);
		}

		// эмуляция в реальном темпе 59.73 кадра/с, независимо от частоты монитора
		const Uint64 now = SDL_GetPerformanceCounter();
		acc += (double)(now - prev) / SDL_GetPerformanceFrequency();
		prev = now;
		if (app.paused) acc = 0;
		else if (fast) { for (int i = 0; i < 6 && !app.paused; i++) app.stepLive(keys); acc = 0; }
		else {
			if (acc > 0.1) acc = kFrameSec;
			int n = 0;
			while (acc >= kFrameSec && n < 4 && !app.paused) { app.stepLive(keys); acc -= kFrameSec; n++; }
		}

		const ImGuiID dock = ImGui::GetID("MainDock");
		if (!ImGui::DockBuilderGetNode(dock)) buildLayout(dock);
		ImGui::DockSpaceOverViewport(dock, ImGui::GetMainViewport());

		app.views.gameWindow(app.emu, 3.0f);
		timelineWindow(app, keys);
		logWindow(app);
		app.views.tilesWindow(app.emu);
		app.views.spritesWindow(app.emu);
		app.views.paletteWindow(app.emu);
		app.views.diffWindow(app.emu, app.diff);
		app.views.memoryWindow(app.emu, app.diff);

		ImGui::Render();
		int dw, dh;
		SDL_GL_GetDrawableSize(win, &dw, &dh);
		glViewport(0, 0, dw, dh);
		glClearColor(0.1f, 0.1f, 0.12f, 1);
		glClear(GL_COLOR_BUFFER_BIT);
		ImGui_ImplOpenGL3_RenderDrawData(ImGui::GetDrawData());
		SDL_GL_SwapWindow(win);
	}

	app.emu.shutdown();
	ImGui_ImplOpenGL3_Shutdown();
	ImGui_ImplSDL2_Shutdown();
	ImGui::DestroyContext();
	SDL_GL_DeleteContext(gl);
	SDL_DestroyWindow(win);
	SDL_Quit();
	return 0;
}
