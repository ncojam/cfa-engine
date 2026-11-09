// gbadbg - отладчик Graveblood: mGBA + перемотка по кадрам + графика/память + трассировка вызовов.
//
//   gbadbg graveblood.gba [--elf out/graveblood.elf] [--src-root DIR] [--binutils PREFIX]
//                         [--save graveblood.sav] [--history-mb 1024]
//
// Управление игрой (как в mGBA): стрелки, X = A, Z = B, A = L, S = R, Enter = Start, Backspace = Select.
// Отладка: Space - пауза/продолжить, ',' / '.' - кадр назад/вперёд (Shift - по 10),
//          Tab (держать) - ускорение, M - пометить кадр как плохой.
#include <SDL.h>
#include <SDL_opengl.h>

#include <cstdio>
#include <cstdlib>
#include <filesystem>
#include <string>

#include "imgui.h"
#include "imgui_impl_opengl3.h"
#include "imgui_impl_sdl2.h"
#include "imgui_internal.h"   // DockBuilder

#include "app.h"

using namespace gbadbg;
namespace fs = std::filesystem;

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
	ImGui::DockBuilderSplitNode(dock, ImGuiDir_Left, 0.42f, &left, &rest);
	ImGui::DockBuilderSplitNode(rest, ImGuiDir_Left, 0.50f, &mid, &right);
	ImGui::DockBuilderSplitNode(left, ImGuiDir_Up, 0.58f, &leftTop, &leftBot);
	ImGui::DockBuilderDockWindow("Game", leftTop);
	ImGui::DockBuilderDockWindow("Timeline", leftBot);
	ImGui::DockBuilderDockWindow("Log", leftBot);
	ImGui::DockBuilderDockWindow("Activity", leftBot);
	ImGui::DockBuilderDockWindow("Tiles", mid);
	ImGui::DockBuilderDockWindow("Source", mid);
	ImGui::DockBuilderDockWindow("Trace", right);
	ImGui::DockBuilderDockWindow("Frame diff", right);
	ImGui::DockBuilderDockWindow("Memory", right);
	ImGui::DockBuilderDockWindow("Sprites", right);
	ImGui::DockBuilderDockWindow("Palette", right);
	ImGui::DockBuilderFinish(dock);
}

static std::string configPath() {
	const char* x = getenv("XDG_CONFIG_HOME");
	const char* h = getenv("HOME");
	fs::path p = x && *x ? fs::path(x) : fs::path(h ? h : ".") / ".config";
	p /= "gbadbg";
	std::error_code ec;
	fs::create_directories(p, ec);
	return (p / "layout2.ini").string();
}

int main(int argc, char** argv) {
	std::string rom, save, elf, srcRoot, binutils;
	int historyMB = 1024;
	for (int i = 1; i < argc; i++) {
		const std::string s = argv[i];
		const bool hasVal = i + 1 < argc;
		if (s == "--save" && hasVal) save = argv[++i];
		else if (s == "--elf" && hasVal) elf = argv[++i];
		else if (s == "--src-root" && hasVal) srcRoot = argv[++i];
		else if (s == "--binutils" && hasVal) binutils = argv[++i];
		else if (s == "--history-mb" && hasVal) historyMB = atoi(argv[++i]);
		else if (s == "-h" || s == "--help") { rom.clear(); break; }
		else rom = s;
	}
	if (rom.empty()) {
		fprintf(stderr, "usage: gbadbg game.gba [--elf out/game.elf] [--src-root DIR] [--binutils PREFIX]\n"
		                "                       [--save game.sav] [--history-mb 1024]\n");
		return 1;
	}
	const fs::path romPath(rom);
	if (save.empty()) {
		fs::path p = romPath;
		p.replace_extension(".sav");
		if (fs::exists(p)) save = p.string();
	}
	if (elf.empty()) {
		// graveblood.gba -> out/graveblood.elf (как в Makefile игры) или graveblood.elf рядом
		const fs::path stem = romPath.stem();
		for (fs::path p : { romPath.parent_path() / "out" / stem, romPath.parent_path() / stem }) {
			p += ".elf";
			if (fs::exists(p)) { elf = p.string(); break; }
		}
	}

	if (SDL_Init(SDL_INIT_VIDEO | SDL_INIT_AUDIO | SDL_INIT_TIMER) != 0) {
		fprintf(stderr, "SDL_Init: %s\n", SDL_GetError());
		return 1;
	}
	SDL_GL_SetAttribute(SDL_GL_CONTEXT_MAJOR_VERSION, 3);
	SDL_GL_SetAttribute(SDL_GL_CONTEXT_MINOR_VERSION, 0);
	SDL_GL_SetAttribute(SDL_GL_DOUBLEBUFFER, 1);
	const std::string title = "gbadbg - " + romPath.filename().string();
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

	static App app;   // большая структура - не на стеке
	std::string err;
	if (!app.emu.load(rom, save, err)) {
		fprintf(stderr, "gbadbg: %s\n", err.c_str());
		return 1;
	}
	app.budgetMB = historyMB;
	app.hist.init(app.emu.stateSize(), (size_t)historyMB << 20);
	printf("gbadbg: %s, save %s, state %zu bytes\n", rom.c_str(), save.empty() ? "(none)" : save.c_str(), app.emu.stateSize());
	if (elf.empty()) printf("gbadbg: no .elf found next to the ROM - tracing disabled (use --elf)\n");
	else if (!app.syms.load(elf, srcRoot, binutils, err)) printf("gbadbg: symbols: %s\n", err.c_str());
	else if (!err.empty()) printf("gbadbg: %s\n", err.c_str());
	app.views.syms = &app.syms;
	app.views.whoWrote = [](uint32_t addr, uint32_t len) {
		if (!app.paused) app.pause();
		app.traceView(addr, len);
	};

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
		activityWindow(app);
		app.views.tilesWindow(app.emu);
		sourceWindow(app);
		traceWindow(app);
		app.views.diffWindow(app.emu, app.diff);
		app.views.memoryWindow(app.emu, app.diff);
		app.views.spritesWindow(app.emu);
		app.views.paletteWindow(app.emu);

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
