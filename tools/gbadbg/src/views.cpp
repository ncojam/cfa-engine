#include "views.h"

#include <SDL.h>
#include <SDL_opengl.h>
#include <algorithm>
#include <cstdio>
#include <cstring>

#include "imgui.h"
#include "symbols.h"

namespace gbadbg {

static ImTextureID tid(const Tex& t) { return (ImTextureID)(intptr_t)t.id; }

void Tex::upload(const uint32_t* rgba, int w_, int h_) {
	if (!id) {
		GLuint t;
		glGenTextures(1, &t);
		id = t;
		glBindTexture(GL_TEXTURE_2D, id);
		glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MIN_FILTER, GL_NEAREST);
		glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MAG_FILTER, GL_NEAREST);
		glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_S, GL_CLAMP_TO_EDGE);
		glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_T, GL_CLAMP_TO_EDGE);
	}
	glBindTexture(GL_TEXTURE_2D, id);
	glPixelStorei(GL_UNPACK_ALIGNMENT, 4);
	if (w_ != w || h_ != h) {
		w = w_; h = h_;
		glTexImage2D(GL_TEXTURE_2D, 0, GL_RGBA, w, h, 0, GL_RGBA, GL_UNSIGNED_BYTE, rgba);
	} else {
		glTexSubImage2D(GL_TEXTURE_2D, 0, 0, 0, w, h, GL_RGBA, GL_UNSIGNED_BYTE, rgba);
	}
}

// BGR555 -> RGBA (байты R,G,B,A)
uint32_t Views::bgr555(const uint8_t* pal, int index) const {
	const uint16_t c = pal[index * 2] | (pal[index * 2 + 1] << 8);
	uint32_t r = c & 31, g = (c >> 5) & 31, b = (c >> 10) & 31;
	r = (r << 3) | (r >> 2); g = (g << 3) | (g >> 2); b = (b << 3) | (b >> 2);
	return 0xFF000000u | (b << 16) | (g << 8) | r;
}

static uint32_t checker(int x, int y) {
	return (((x >> 2) ^ (y >> 2)) & 1) ? 0xFF3A3A3Au : 0xFF2A2A2Au;
}

void Views::beforeFrame(Emu& emu) {
	size_t s = 0;
	uint8_t* v = emu.mem(R_VRAM, &s);
	if (v) prevVram.assign(v, v + s);
}

// ============================ экран игры ============================

// размеры спрайта по shape/size
static void objSize(int shape, int size, int& w, int& h) {
	static const int T[3][4][2] = {
		{ { 8, 8 }, { 16, 16 }, { 32, 32 }, { 64, 64 } },
		{ { 16, 8 }, { 32, 8 }, { 32, 16 }, { 64, 32 } },
		{ { 8, 16 }, { 8, 32 }, { 16, 32 }, { 32, 64 } },
	};
	if (shape > 2) shape = 0;
	w = T[shape][size][0];
	h = T[shape][size][1];
}

struct Obj {
	int x, y, w, h;
	bool visible, affine, dbl, bpp8, hflip, vflip;
	int mode, tile, pal, prio, affIdx;
};

static Obj readObj(const uint8_t* oam, int i) {
	const uint16_t a0 = oam[i * 8] | (oam[i * 8 + 1] << 8);
	const uint16_t a1 = oam[i * 8 + 2] | (oam[i * 8 + 3] << 8);
	const uint16_t a2 = oam[i * 8 + 4] | (oam[i * 8 + 5] << 8);
	Obj o{};
	o.affine = a0 & (1 << 8);
	o.dbl = o.affine && (a0 & (1 << 9));
	o.visible = o.affine || !(a0 & (1 << 9));
	o.mode = (a0 >> 10) & 3;
	o.bpp8 = a0 & (1 << 13);
	objSize(a0 >> 14, a1 >> 14, o.w, o.h);
	o.y = a0 & 0xFF; if (o.y >= 160) o.y -= 256;
	o.x = a1 & 0x1FF; if (o.x >= 240) o.x -= 512;
	o.hflip = !o.affine && (a1 & (1 << 12));
	o.vflip = !o.affine && (a1 & (1 << 13));
	o.affIdx = o.affine ? (a1 >> 9) & 31 : -1;
	o.tile = a2 & 0x3FF;
	o.prio = (a2 >> 10) & 3;
	o.pal = (a2 >> 12) & 15;
	if (o.mode == 3) o.visible = false;   // запрещённый режим
	return o;
}

void Views::gameWindow(Emu& emu, float scale, const std::string& status) {
	ImGui::Begin("Game");
	if (status.empty()) ImGui::TextColored(ImVec4(0.5f, 1, 0.5f, 1), "running");
	else ImGui::TextColored(ImVec4(1, 0.45f, 0.35f, 1), "PAUSED - %s", status.c_str());
	gameTex.upload(emu.pixels(), Emu::W, Emu::H);
	const ImVec2 p0 = ImGui::GetCursorScreenPos();
	ImGui::Image(tid(gameTex), ImVec2(Emu::W * scale, Emu::H * scale));

	// рамки спрайтов (наведение в окне Sprites или «все»)
	const uint8_t* oam = emu.mem(R_OAM);
	ImDrawList* dl = ImGui::GetWindowDrawList();
	if (oam) {
		for (int i = 0; i < 128; i++) {
			if (!spriteBoxesAll && i != hoveredSprite) continue;
			Obj o = readObj(oam, i);
			if (!o.visible) continue;
			const int bw = o.dbl ? o.w * 2 : o.w, bh = o.dbl ? o.h * 2 : o.h;
			const ImU32 col = i == hoveredSprite ? IM_COL32(255, 40, 40, 255) : IM_COL32(255, 220, 0, 160);
			dl->AddRect(ImVec2(p0.x + o.x * scale, p0.y + o.y * scale),
				ImVec2(p0.x + (o.x + bw) * scale, p0.y + (o.y + bh) * scale), col, 0, 0, i == hoveredSprite ? 2.f : 1.f);
		}
	}
	if (ImGui::IsItemHovered()) {
		const ImVec2 m = ImGui::GetMousePos();
		ImGui::SetTooltip("x %d  y %d", (int)((m.x - p0.x) / scale), (int)((m.y - p0.y) / scale));
	}
	ImGui::Checkbox("sprite boxes", &spriteBoxesAll);
	ImGui::SameLine();
	ImGui::Checkbox("mute", &emu.muted);
	ImGui::SameLine();
	ImGui::SetNextItemWidth(120);
	ImGui::SliderFloat("volume", &emu.volume, 0.f, 1.f, "%.2f");
	ImGui::End();
}

// ============================ тайлы VRAM ============================

void Views::tilesWindow(Emu& emu) {
	ImGui::Begin("Tiles");
	size_t vs = 0;
	const uint8_t* vram = emu.mem(R_VRAM, &vs);
	const uint8_t* pal = emu.mem(R_PAL);
	if (!vram || !pal) { ImGui::End(); return; }

	static const char* sections[] = { "OBJ 06010000", "BG all 06000000", "BG cb0 06000000", "BG cb1 06004000", "BG cb2 06008000", "BG cb3 0600C000" };
	ImGui::SetNextItemWidth(150);
	ImGui::Combo("##sec", &tileSection, sections, 6);
	ImGui::SameLine();
	ImGui::Checkbox("8bpp", &tile8bpp);
	ImGui::SameLine();
	ImGui::SetNextItemWidth(70);
	ImGui::InputInt("per row", &tilesPerRow, 0);
	tilesPerRow = std::clamp(tilesPerRow, 1, 128);
	ImGui::SameLine();
	ImGui::SetNextItemWidth(60);
	ImGui::SliderInt("x", &tileScale, 1, 4);
	if (!tile8bpp) { ImGui::SameLine(); ImGui::SetNextItemWidth(80); ImGui::SliderInt("pal", &palBank, 0, 15); }
	ImGui::Checkbox("empty=checker", &tileChecker);
	ImGui::SameLine();
	ImGui::Checkbox("changed this frame", &tileChanged);
	ImGui::SameLine();
	ImGui::Checkbox("grid", &tileGrid);

	uint32_t start = 0, len = 0x10000;
	if (tileSection == 0) { start = 0x10000; len = 0x8000; }
	else if (tileSection >= 2) { start = (tileSection - 2) * 0x4000; len = 0x4000; }
	const bool obj = tileSection == 0;
	const int tb = tile8bpp ? 64 : 32;
	const int n = len / tb;
	const int rows = (n + tilesPerRow - 1) / tilesPerRow;
	const int W = tilesPerRow * 8, H = rows * 8;
	img.assign((size_t)W * H, 0);
	const int palBase = obj ? 256 : 0;

	for (int t = 0; t < n; t++) {
		const uint8_t* src = vram + start + t * tb;
		const int ox = (t % tilesPerRow) * 8, oy = (t / tilesPerRow) * 8;
		for (int y = 0; y < 8; y++)
			for (int x = 0; x < 8; x++) {
				int idx;
				if (tile8bpp) idx = src[y * 8 + x];
				else { const uint8_t b = src[y * 4 + x / 2]; idx = (x & 1) ? b >> 4 : b & 15; }
				uint32_t c;
				if (idx == 0 && tileChecker) c = checker(ox + x, oy + y);
				else c = bgr555(pal, palBase + (tile8bpp ? idx : palBank * 16 + idx));
				img[(size_t)(oy + y) * W + ox + x] = c;
			}
	}
	tilesTex.upload(img.data(), W, H);

	ImGui::BeginChild("tilesimg", ImVec2(0, 0), 0, ImGuiWindowFlags_HorizontalScrollbar);
	const ImVec2 p0 = ImGui::GetCursorScreenPos();
	const float s = (float)tileScale;
	ImGui::Image(tid(tilesTex), ImVec2(W * s, H * s));
	ImDrawList* dl = ImGui::GetWindowDrawList();
	if (tileGrid)
		for (int r = 0; r <= rows; r++) {
			const ImU32 c = (r % 8 == 0) ? IM_COL32(0, 160, 255, 110) : IM_COL32(255, 255, 255, 30);
			dl->AddLine(ImVec2(p0.x, p0.y + r * 8 * s), ImVec2(p0.x + W * s, p0.y + r * 8 * s), c);
		}
	// тайлы, изменённые за последний выполненный кадр
	if (tileChanged && prevVram.size() == vs) {
		int drawn = 0;
		for (int t = 0; t < n && drawn < 3000; t++) {
			if (!memcmp(vram + start + t * tb, prevVram.data() + start + t * tb, tb)) continue;
			const float x = p0.x + (t % tilesPerRow) * 8 * s, y = p0.y + (t / tilesPerRow) * 8 * s;
			dl->AddRect(ImVec2(x, y), ImVec2(x + 8 * s, y + 8 * s), IM_COL32(255, 50, 50, 220));
			drawn++;
		}
	}
	if (ImGui::IsItemHovered()) {
		const ImVec2 m = ImGui::GetMousePos();
		const int tx = (int)((m.x - p0.x) / (8 * s)), ty = (int)((m.y - p0.y) / (8 * s));
		const int t = ty * tilesPerRow + tx;
		if (tx >= 0 && tx < tilesPerRow && t >= 0 && t < n) {
			const uint32_t off = start + t * tb;
			ImGui::BeginTooltip();
			ImGui::Text("addr 0x%08X", 0x06000000 + off);
			ImGui::Text("tile #%d in section (%s)", t, tile8bpp ? "8bpp, 64 B" : "4bpp, 32 B");
			if (obj) ImGui::Text("OAM tile index (32 B units): %u", (off - 0x10000) / 32);
			else ImGui::Text("charblock %u, BG tile no %u (8bpp) / %u (4bpp)", off / 0x4000, (off % 0x4000) / 64, (off % 0x4000) / 32);
			const ImVec2 uv0((tx * 8.f) / W, (ty * 8.f) / H), uv1(((tx + 1) * 8.f) / W, ((ty + 1) * 8.f) / H);
			ImGui::Image(tid(tilesTex), ImVec2(96, 96), uv0, uv1);
			ImGui::EndTooltip();
		}
	}
	ImGui::EndChild();
	ImGui::End();
}

// ============================ спрайты ============================

void Views::spritesWindow(Emu& emu) {
	ImGui::Begin("Sprites");
	const uint8_t* oam = emu.mem(R_OAM);
	const uint8_t* vram = emu.mem(R_VRAM);
	const uint8_t* pal = emu.mem(R_PAL);
	if (!oam || !vram || !pal) { ImGui::End(); return; }
	const uint16_t dispcnt = emu.io16(0);
	const bool map1D = dispcnt & (1 << 6);
	int visible = 0;
	for (int i = 0; i < 128; i++) visible += readObj(oam, i).visible;
	ImGui::Text("OBJ mapping %s, visible %d / 128%s", map1D ? "1D" : "2D", visible, (dispcnt & (1 << 12)) ? "" : "  (OBJ layer OFF)");
	ImGui::Checkbox("visible only", &spritesVisibleOnly);

	// атлас: 128 ячеек 64x64 (8 в ряд); аффинные - без преобразования
	const int AW = 8 * 64, AH = 16 * 64;
	img.assign((size_t)AW * AH, 0);
	for (int i = 0; i < 128; i++) {
		Obj o = readObj(oam, i);
		if (!o.visible) continue;
		const int cx = (i % 8) * 64, cy = (i / 8) * 64;
		const int tw = o.w / 8;
		for (int py = 0; py < o.h; py++)
			for (int px = 0; px < o.w; px++) {
				const int sx = o.hflip ? o.w - 1 - px : px, sy = o.vflip ? o.h - 1 - py : py;
				const int tx = sx / 8, ty = sy / 8;
				int t = map1D ? o.tile + (ty * tw + tx) * (o.bpp8 ? 2 : 1)
				              : o.tile + ty * 32 + tx * (o.bpp8 ? 2 : 1);
				const uint32_t addr = 0x10000 + (t & 0x3FF) * 32;
				int idx;
				if (o.bpp8) idx = vram[addr + (sy % 8) * 8 + sx % 8];
				else { const uint8_t b = vram[addr + (sy % 8) * 4 + (sx % 8) / 2]; idx = (sx & 1) ? b >> 4 : b & 15; }
				img[(size_t)(cy + py) * AW + cx + px] = idx == 0 ? checker(px, py)
					: bgr555(pal, 256 + (o.bpp8 ? idx : o.pal * 16 + idx));
			}
	}
	spriteAtlas.upload(img.data(), AW, AH);

	hoveredSprite = -1;
	if (ImGui::BeginTable("oam", 8, ImGuiTableFlags_RowBg | ImGuiTableFlags_ScrollY | ImGuiTableFlags_BordersInnerV | ImGuiTableFlags_SizingFixedFit)) {
		ImGui::TableSetupScrollFreeze(0, 1);
		ImGui::TableSetupColumn("#");
		ImGui::TableSetupColumn("img");
		ImGui::TableSetupColumn("x,y");
		ImGui::TableSetupColumn("size");
		ImGui::TableSetupColumn("tile");
		ImGui::TableSetupColumn("pal");
		ImGui::TableSetupColumn("pri");
		ImGui::TableSetupColumn("flags");
		ImGui::TableHeadersRow();
		for (int i = 0; i < 128; i++) {
			Obj o = readObj(oam, i);
			if (spritesVisibleOnly && !o.visible) continue;
			ImGui::TableNextRow();
			ImGui::TableNextColumn();
			ImGui::Text("%d", i);
			ImGui::TableNextColumn();
			if (o.visible) {
				const float cx = (i % 8) * 64.f, cy = (i / 8) * 64.f;
				ImGui::Image(tid(spriteAtlas), ImVec2((float)o.w, (float)o.h),
					ImVec2(cx / AW, cy / AH), ImVec2((cx + o.w) / AW, (cy + o.h) / AH));
			}
			ImGui::TableNextColumn(); ImGui::Text("%d,%d", o.x, o.y);
			ImGui::TableNextColumn(); ImGui::Text("%dx%d", o.w, o.h);
			ImGui::TableNextColumn(); ImGui::Text("%d", o.tile);
			ImGui::TableNextColumn(); ImGui::Text(o.bpp8 ? "256" : "%d", o.pal);
			ImGui::TableNextColumn(); ImGui::Text("%d", o.prio);
			ImGui::TableNextColumn();
			ImGui::Text("%s%s%s%s%s", o.hflip ? "H " : "", o.vflip ? "V " : "", o.affine ? "aff " : "", o.dbl ? "dbl " : "",
				o.mode == 1 ? "blend" : o.mode == 2 ? "window" : "");
			// наведение на строку - рамка на экране игры
			ImGui::SameLine();
			ImGui::Selectable("##row", false, ImGuiSelectableFlags_SpanAllColumns | ImGuiSelectableFlags_AllowOverlap);
			if (ImGui::IsItemHovered()) hoveredSprite = i;
		}
		ImGui::EndTable();
	}
	ImGui::End();
}

// ============================ палитры ============================

void Views::paletteWindow(Emu& emu) {
	ImGui::Begin("Palette");
	const uint8_t* pal = emu.mem(R_PAL);
	if (!pal) { ImGui::End(); return; }
	for (int half = 0; half < 2; half++) {
		ImGui::Text(half ? "OBJ palette (05000200)" : "BG palette (05000000)");
		const ImVec2 p0 = ImGui::GetCursorScreenPos();
		const float sz = 14;
		ImDrawList* dl = ImGui::GetWindowDrawList();
		for (int i = 0; i < 256; i++) {
			const uint32_t c = bgr555(pal, half * 256 + i);
			const ImVec2 a(p0.x + (i % 16) * sz, p0.y + (i / 16) * sz);
			dl->AddRectFilled(a, ImVec2(a.x + sz - 1, a.y + sz - 1), c);
		}
		ImGui::InvisibleButton(half ? "objpal" : "bgpal", ImVec2(16 * sz, 16 * sz));
		if (ImGui::IsItemHovered()) {
			const ImVec2 m = ImGui::GetMousePos();
			const int i = (int)((m.y - p0.y) / sz) * 16 + (int)((m.x - p0.x) / sz);
			if (i >= 0 && i < 256) {
				const int k = half * 256 + i;
				ImGui::SetTooltip("index %d (bank %d, %d)\nBGR555 0x%04X", i, i / 16, i % 16, pal[k * 2] | (pal[k * 2 + 1] << 8));
			}
		}
	}
	ImGui::End();
}

// ============================ изменения памяти за кадр ============================

void FrameDiff::compute(int64_t f) {
	frame = f;
	for (auto& r : regions) {
		r.ranges.clear();
		r.changed = 0;
		const size_t n = std::min(r.before.size(), r.after.size());
		size_t i = 0;
		while (i < n) {
			if (r.before[i] == r.after[i]) { i++; continue; }
			size_t s = i, e = i;
			// склеиваем изменения, между которыми меньше 16 одинаковых байт
			while (i < n) {
				if (r.before[i] != r.after[i]) { r.changed++; e = ++i; continue; }
				if (i - e >= 16) break;
				i++;
			}
			r.ranges.push_back({ (uint32_t)s, (uint32_t)(e - s) });
		}
	}
}

void Views::diffWindow(Emu& emu, FrameDiff& diff) {
	(void)emu;
	ImGui::Begin("Frame diff");
	if (diff.frame < 0) {
		ImGui::TextWrapped("Pause and select a frame: shows which memory changed during that frame (state before vs after).");
		ImGui::End();
		return;
	}
	ImGui::Text("Frame %lld: before -> after", (long long)diff.frame);
	for (int i = 0; i < (int)diff.regions.size(); i++) {
		const RegionDiff& r = diff.regions[i];
		char label[96];
		snprintf(label, sizeof(label), "%-8s %7zu bytes changed, %zu ranges", r.info.name, r.changed, r.ranges.size());
		if (ImGui::Selectable(label, diffSel == i)) { diffSel = i; diffRangeSel = -1; }
	}
	ImGui::Separator();
	if (diffSel >= 0 && diffSel < (int)diff.regions.size()) {
		const RegionDiff& r = diff.regions[diffSel];
		if (diffRangeSel >= 0 && diffRangeSel < (int)r.ranges.size() && whoWrote) {
			const auto& rg = r.ranges[diffRangeSel];
			if (ImGui::Button("Who wrote this range? (trace frame, see Trace > Events)"))
				whoWrote(r.info.base + rg.first, std::min<uint32_t>(rg.second, 256));
		}
		ImGui::BeginChild("ranges", ImVec2(0, 0));
		ImGuiListClipper clip;
		clip.Begin((int)r.ranges.size());
		while (clip.Step())
			for (int k = clip.DisplayStart; k < clip.DisplayEnd; k++) {
				const auto& rg = r.ranges[k];
				char l[256];
				const std::string nm = syms ? syms->dataName(r.info.base + rg.first) : std::string();
				snprintf(l, sizeof(l), "%08X  +%-6u %s", r.info.base + rg.first, rg.second, nm.c_str());
				if (ImGui::Selectable(l, diffRangeSel == k)) {
					diffRangeSel = k;
					for (int m = 0; m < kRegionCount; m++)
						if (kRegions[m].id == r.info.id) memRegion = m;
					gotoAddress(r.info.base + rg.first);
				}
				if (ImGui::IsItemHovered()) {
					// первые байты: было -> стало
					ImGui::BeginTooltip();
					const uint32_t cnt = std::min<uint32_t>(rg.second, 32);
					std::string a, b;
					char h[4];
					for (uint32_t q = 0; q < cnt; q++) {
						snprintf(h, sizeof(h), "%02X ", r.before[rg.first + q]); a += h;
						snprintf(h, sizeof(h), "%02X ", r.after[rg.first + q]); b += h;
					}
					ImGui::Text("before: %s", a.c_str());
					ImGui::Text("after:  %s", b.c_str());
					ImGui::EndTooltip();
				}
			}
		ImGui::EndChild();
	}
	ImGui::End();
}

// ============================ hex ============================

void Views::memoryWindow(Emu& emu, const FrameDiff& diff) {
	ImGui::Begin("Memory");
	const char* names[8];
	for (int i = 0; i < kRegionCount; i++) names[i] = kRegions[i].name;
	ImGui::SetNextItemWidth(110);
	ImGui::Combo("##reg", &memRegion, names, kRegionCount);
	ImGui::SameLine();
	static char addrBuf[16] = "";
	ImGui::SetNextItemWidth(110);
	if (ImGui::InputText("goto (hex)", addrBuf, sizeof(addrBuf), ImGuiInputTextFlags_EnterReturnsTrue | ImGuiInputTextFlags_CharsHexadecimal)) {
		const uint32_t a = (uint32_t)strtoul(addrBuf, nullptr, 16);
		for (int i = 0; i < kRegionCount; i++)
			if ((a >> 24) == (uint32_t)kRegions[i].id) memRegion = i;
		gotoAddress(a);
	}
	ImGui::SameLine();
	static char watchBuf[16] = "";
	static int watchLen = 4;
	ImGui::SetNextItemWidth(90);
	ImGui::InputText("##w", watchBuf, sizeof(watchBuf), ImGuiInputTextFlags_CharsHexadecimal);
	ImGui::SameLine(); ImGui::SetNextItemWidth(60);
	ImGui::InputInt("bytes", &watchLen, 0);
	watchLen = std::clamp(watchLen, 1, 256);
	ImGui::SameLine();
	if (ImGui::Button("Who wrote?") && whoWrote && watchBuf[0]) whoWrote((uint32_t)strtoul(watchBuf, nullptr, 16), (uint32_t)watchLen);
	if (ImGui::IsItemHovered()) ImGui::SetTooltip("trace the shown frame and report every write to [addr, +bytes] with call stack (Trace > Events).\nRight-click a byte to put its address here.");
	const RegionInfo& ri = kRegions[memRegion];
	size_t size = 0;
	const uint8_t* m = emu.mem(ri.id, &size);
	if (!m) { ImGui::End(); return; }
	size = std::min<size_t>(size, ri.size);

	// подсветка байт, изменённых в посчитанном кадре
	const RegionDiff* rd = nullptr;
	for (auto& r : diff.regions) if (r.info.id == ri.id) rd = &r;

	ImGui::BeginChild("hex", ImVec2(0, 0), 0, ImGuiWindowFlags_HorizontalScrollbar);
	const float lineH = ImGui::GetTextLineHeightWithSpacing();
	if (memGotoPending && (memGoto >> 24) == (uint32_t)ri.id) {
		ImGui::SetScrollY(((memGoto & 0xFFFFFF) / 16) * lineH - lineH * 4);
		memGotoPending = false;
	}
	ImGuiListClipper clip;
	clip.Begin((int)(size / 16), lineH);
	const ImU32 hl = IM_COL32(255, 90, 90, 255);
	while (clip.Step())
		for (int row = clip.DisplayStart; row < clip.DisplayEnd; row++) {
			const uint32_t off = row * 16;
			ImGui::Text("%08X ", ri.base + off);
			for (int k = 0; k < 16; k++) {
				ImGui::SameLine(0, k == 8 ? 10 : 4);
				const uint8_t v = m[off + k];
				const bool ch = rd && off + k < rd->before.size() && rd->before[off + k] != rd->after[off + k];
				if (ch) ImGui::TextColored(ImColor(hl), "%02X", v);
				else ImGui::Text("%02X", v);
				if (ImGui::IsItemHovered()) {
					const uint32_t ad = ri.base + off + k;
					const std::string nm = syms ? syms->dataName(ad) : std::string();
					if (ch) ImGui::SetTooltip("%08X %s\n%02X -> %02X this frame", ad, nm.c_str(), rd->before[off + k], rd->after[off + k]);
					else ImGui::SetTooltip("%08X %s", ad, nm.c_str());
					if (ImGui::IsMouseClicked(1)) snprintf(watchBuf, sizeof(watchBuf), "%08X", ad);   // ПКМ - в поле «Who wrote»
				}
			}
			ImGui::SameLine(0, 12);
			char asc[17];
			for (int k = 0; k < 16; k++) { const uint8_t v = m[off + k]; asc[k] = (v >= 32 && v < 127) ? (char)v : '.'; }
			asc[16] = 0;
			ImGui::TextUnformatted(asc);
		}
	ImGui::EndChild();
	ImGui::End();
}

} // namespace gbadbg
