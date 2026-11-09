// Окна отладчика: таймлайн, лог, трассировка кадра, исходник, лента активности.
#include <algorithm>
#include <cstdarg>
#include <cstdio>
#include <cstring>
#include <filesystem>

#include "app.h"
#include "imgui.h"

namespace gbadbg {

static const double kFrameCycles = 280896.0;

// ============================ текст для копирования ============================

static std::string fmt(const char* f, ...) IM_FMTARGS(1);
static std::string fmt(const char* f, ...) {
	char b[1024];
	va_list ap;
	va_start(ap, f);
	vsnprintf(b, sizeof(b), f, ap);
	va_end(ap);
	return b;
}

static std::string stackText(App& a, const std::vector<StackPos>& st) {
	std::string s;
	for (int i = 0; i < (int)st.size(); i++)
		s += fmt("  %2d  %-40s %-34s [%08X]\n", i, a.syms.shortName(st[i].fn).c_str(), a.syms.where(st[i].addr).c_str(), st[i].addr);
	return s;
}

static std::string eventText(App& a, const TraceEvent& e) {
	return fmt("%s @ instr %llu, pc %08X (%s)  %s\n", e.kind == TraceEvent::ERROR ? "ERROR" : "WRITE",
		(unsigned long long)e.step, e.pc, a.syms.where(e.pc).c_str(), e.text.c_str()) + stackText(a, e.stack);
}

// Всё важное о показанном кадре одним текстом - вставить в чат / баг-репорт
static std::string reportText(App& a) {
	std::string s = fmt("gbadbg report: frame %lld\n", (long long)a.view);
	if (a.paused && !a.pauseReason.empty()) s += "pause: " + a.pauseReason + "\n";
	if (a.view >= 0 && a.marks.count((uint32_t)a.view)) s += "marked bad: " + a.marks[(uint32_t)a.view] + "\n";

	s += "\n-- log (this frame) --\n";
	for (const LogLine& l : a.emu.log)
		if ((int64_t)l.frame == a.view) s += fmt("%s: %s%s\n", l.cat.c_str(), l.text.c_str(), l.repeat > 1 ? fmt("  (x%d)", l.repeat).c_str() : "");

	const Trace& t = a.trace;
	if (t.frame == a.view && t.frame >= 0) {
		s += fmt("\n-- trace: %llu instructions, %.1f%% of frame --\n", (unsigned long long)t.steps, t.cycles * 100.0 / kFrameCycles);
		if (t.watchLen) s += fmt("watch %08X +%u %s\n", t.watchAddr, t.watchLen, a.syms.dataName(t.watchAddr).c_str());
		for (const TraceEvent& e : t.events) s += eventText(a, e);
		s += "end of frame stack:\n" + stackText(a, t.endStack);
		s += "top functions by cycles:\n";
		for (int i = 0; i < (int)t.flat.size() && i < 15; i++)
			s += fmt("  %5.2f%%  x%-4u %s\n", t.flat[i].self * 100.0 / kFrameCycles, t.flat[i].calls, a.syms.shortName(t.flat[i].fn).c_str());
	}
	if (a.diff.frame == a.view && a.diff.frame >= 0) {
		s += "\n-- memory changed this frame --\n";
		for (const RegionDiff& r : a.diff.regions) {
			s += fmt("%-8s %zu bytes, %zu ranges\n", r.info.name, r.changed, r.ranges.size());
			for (int k = 0; k < (int)r.ranges.size() && k < 12; k++)
				s += fmt("    %08X +%u %s\n", r.info.base + r.ranges[k].first, r.ranges[k].second, a.syms.dataName(r.info.base + r.ranges[k].first).c_str());
		}
	}
	return s;
}

// ============================ таймлайн ============================

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
	const float mx = std::clamp(ImGui::GetIO().MousePos.x - p0.x, 0.f, w - 1);
	const int64_t f = (int64_t)(first + mx / (w - 1) * span + 0.5);
	if (ImGui::IsItemActive()) {
		if (!a.paused) a.pause();
		if (f != a.view) a.seek(f);
	}
	if (ImGui::IsItemHovered()) ImGui::SetTooltip("frame %lld", (long long)f);
}

void timelineWindow(App& a, uint32_t liveKeys) {
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
	else if (ImGui::SmallButton("copy list")) {
		std::string s;
		for (uint32_t f : a.errorFrames) {
			const char* text = "";
			for (auto l = a.emu.log.rbegin(); l != a.emu.log.rend(); ++l)
				if (l->frame == f && l->isError()) { text = l->text.c_str(); break; }
			s += fmt("%u  %s\n", f, text);
		}
		ImGui::SetClipboardText(s.c_str());
	}
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
			"'Frame diff' = what frame N changed; Tiles red boxes = tiles written during frame N;\n"
			"'Trace' = functions frame N called, error call stacks, 'who wrote' results.");
	}
	ImGui::End();
}

// ============================ лог ============================

void logWindow(App& a) {
	ImGui::Begin("Log");
	static bool errorsOnly = false, follow = true;
	static char filter[64] = "";
	ImGui::Checkbox("errors only", &errorsOnly);
	ImGui::SameLine(); ImGui::Checkbox("follow", &follow);
	ImGui::SameLine(); ImGui::SetNextItemWidth(200);
	ImGui::InputTextWithHint("##flt", "filter", filter, sizeof(filter));
	ImGui::SameLine(); if (ImGui::SmallButton("clear")) a.emu.log.clear();
	ImGui::SameLine(); const bool copy = ImGui::SmallButton("copy");
	if (ImGui::IsItemHovered()) ImGui::SetTooltip("copy shown lines (filter applies) to clipboard");

	ImGui::BeginChild("lines", ImVec2(0, 0), 0, ImGuiWindowFlags_HorizontalScrollbar);
	std::vector<int> idx;
	idx.reserve(a.emu.log.size());
	for (int i = 0; i < (int)a.emu.log.size(); i++) {
		const LogLine& l = a.emu.log[i];
		if (errorsOnly && !l.isError()) continue;
		if (filter[0] && l.text.find(filter) == std::string::npos && l.cat.find(filter) == std::string::npos) continue;
		idx.push_back(i);
	}
	if (copy) {
		std::string s;
		for (int k = std::max(0, (int)idx.size() - 5000); k < (int)idx.size(); k++) {
			const LogLine& l = a.emu.log[idx[k]];
			s += fmt("%u  %s  %s%s\n", l.frame, l.cat.c_str(), l.text.c_str(), l.repeat > 1 ? fmt("  (x%d)", l.repeat).c_str() : "");
		}
		ImGui::SetClipboardText(s.c_str());
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

// ============================ трассировка ============================

static void stackList(App& a, const std::vector<StackPos>& st, const char* id) {
	ImGui::PushID(id);
	for (int i = 0; i < (int)st.size(); i++) {
		const StackPos& s = st[i];
		char l[600];
		snprintf(l, sizeof(l), "%2d  %s   %s  [%08X]##%d", i, a.syms.shortName(s.fn).c_str(), a.syms.where(s.addr).c_str(), s.addr, i);
		if (ImGui::Selectable(l, false)) a.showAddr(s.addr);
		if (ImGui::IsItemHovered() && s.fn >= 0) ImGui::SetTooltip("%s", a.syms.funcName(s.fn));
	}
	ImGui::PopID();
}

static void treeNode(App& a, int idx, int depth) {
	const Trace& t = a.trace;
	const TraceNode& n = t.nodes[idx];
	std::vector<int> ch = n.children;
	std::sort(ch.begin(), ch.end(), [&](int x, int y) { return t.nodes[x].incl > t.nodes[y].incl; });
	char label[600];
	if (idx == 0) snprintf(label, sizeof(label), "frame %lld##n0", (long long)t.frame);
	else snprintf(label, sizeof(label), "%s   x%u   %.1f%% (self %.1f%%)##n%d", a.syms.shortName(n.fn).c_str(), n.calls,
		n.incl * 100.0 / kFrameCycles, n.self * 100.0 / kFrameCycles, idx);
	ImGuiTreeNodeFlags fl = ImGuiTreeNodeFlags_OpenOnArrow | ImGuiTreeNodeFlags_SpanAvailWidth;
	if (ch.empty()) fl |= ImGuiTreeNodeFlags_Leaf;
	if (depth < 2) fl |= ImGuiTreeNodeFlags_DefaultOpen;
	const bool open = ImGui::TreeNodeEx(label, fl);
	if (ImGui::IsItemClicked() && !ImGui::IsItemToggledOpen()) a.showFunc(n.fn);
	if (ImGui::IsItemHovered() && n.fn >= 0) ImGui::SetTooltip("%s\n%s", a.syms.funcName(n.fn), a.syms.where(a.syms.func(n.fn).addr).c_str());
	if (open) {
		for (int c : ch) treeNode(a, c, depth + 1);
		ImGui::TreePop();
	}
}

void traceWindow(App& a) {
	ImGui::Begin("Trace");
	if (!a.hasSymbols()) {
		ImGui::TextWrapped("No symbols. Build the game with -g (Makefile) and start gbadbg with the ROM next to out/<name>.elf, "
			"or pass --elf path. DEVKITARM must be set (binutils arm-none-eabi-nm/objdump are used).");
		ImGui::End();
		return;
	}
	ImGui::Checkbox("live trace", &a.liveTrace);
	if (ImGui::IsItemHovered()) ImGui::SetTooltip("trace every frame while playing: Activity feed + Source follows new functions");
	ImGui::SameLine(); ImGui::Checkbox("trace on pause/seek", &a.autoTrace);
	ImGui::SameLine();
	ImGui::BeginDisabled(a.view < 0);
	if (ImGui::Button("Trace shown frame")) { if (!a.paused) a.pause(); a.traceView(); }
	ImGui::EndDisabled();
	ImGui::SameLine();
	if (ImGui::Button("Copy report")) ImGui::SetClipboardText(reportText(a).c_str());
	if (ImGui::IsItemHovered()) ImGui::SetTooltip("frame log, errors with call stacks, top functions, changed memory - as text");

	const Trace& t = a.trace;
	if (t.frame < 0) { ImGui::TextDisabled("no trace yet"); ImGui::End(); return; }
	ImGui::Text("frame %lld: %llu instructions, %llu cycles = %.1f%% of frame (rest: halt/VBlank wait)", (long long)t.frame,
		(unsigned long long)t.steps, (unsigned long long)t.cycles, t.cycles * 100.0 / kFrameCycles);
	if (t.frame != a.view) ImGui::TextColored(ImVec4(1, 0.7f, 0.2f, 1), "(trace is for frame %lld, shown frame is %lld)", (long long)t.frame, (long long)a.view);

	if (ImGui::BeginTabBar("trtabs")) {
		char evTitle[48];
		snprintf(evTitle, sizeof(evTitle), "Events (%zu)###ev", t.events.size());
		if (ImGui::BeginTabItem(evTitle)) {
			if (t.watchLen) ImGui::Text("watch: %08X +%u (%s)", t.watchAddr, t.watchLen, a.syms.dataName(t.watchAddr).c_str());
			if (t.events.empty()) ImGui::TextDisabled(t.watchLen ? "nothing wrote to the watched bytes in this frame" : "no errors in this frame");
			ImGui::BeginChild("evs");
			for (int i = 0; i < (int)t.events.size(); i++) {
				const TraceEvent& e = t.events[i];
				ImGui::PushID(i);
				const ImVec4 col = e.kind == TraceEvent::ERROR ? ImVec4(1, 0.4f, 0.4f, 1) : ImVec4(0.5f, 0.85f, 1, 1);
				if (ImGui::SmallButton("copy")) ImGui::SetClipboardText(eventText(a, e).c_str());
				ImGui::SameLine();
				ImGui::TextColored(col, "%s @ instr %llu, pc %08X  %s", e.kind == TraceEvent::ERROR ? "ERROR" : "WRITE",
					(unsigned long long)e.step, e.pc, e.text.c_str());
				stackList(a, e.stack, "st");
				ImGui::Separator();
				ImGui::PopID();
			}
			ImGui::EndChild();
			ImGui::EndTabItem();
		}
		if (ImGui::BeginTabItem("Call tree")) {
			ImGui::BeginChild("tree");
			treeNode(a, 0, 0);
			ImGui::EndChild();
			ImGui::EndTabItem();
		}
		if (ImGui::BeginTabItem("Profile")) {
			if (ImGui::BeginTable("prof", 4, ImGuiTableFlags_RowBg | ImGuiTableFlags_ScrollY | ImGuiTableFlags_Resizable | ImGuiTableFlags_BordersInnerV)) {
				ImGui::TableSetupScrollFreeze(0, 1);
				ImGui::TableSetupColumn("function", ImGuiTableColumnFlags_WidthStretch);
				ImGui::TableSetupColumn("calls", ImGuiTableColumnFlags_WidthFixed, 50);
				ImGui::TableSetupColumn("self cycles", ImGuiTableColumnFlags_WidthFixed, 80);
				ImGui::TableSetupColumn("% frame", ImGuiTableColumnFlags_WidthFixed, 60);
				ImGui::TableHeadersRow();
				for (int i = 0; i < (int)t.flat.size(); i++) {
					const FlatRow& r = t.flat[i];
					ImGui::TableNextRow();
					ImGui::TableNextColumn();
					ImGui::PushID(i);
					if (ImGui::Selectable(a.syms.shortName(r.fn).c_str(), false, ImGuiSelectableFlags_SpanAllColumns)) a.showFunc(r.fn);
					if (ImGui::IsItemHovered() && r.fn >= 0) ImGui::SetTooltip("%s", a.syms.funcName(r.fn));
					ImGui::PopID();
					ImGui::TableNextColumn(); ImGui::Text("%u", r.calls);
					ImGui::TableNextColumn(); ImGui::Text("%llu", (unsigned long long)r.self);
					ImGui::TableNextColumn(); ImGui::Text("%.2f", r.self * 100.0 / kFrameCycles);
				}
				ImGui::EndTable();
			}
			ImGui::EndTabItem();
		}
		if (ImGui::BeginTabItem("End stack")) {
			ImGui::TextDisabled("where the CPU was when the frame ended (usually waiting for VBlank)");
			stackList(a, t.endStack, "end");
			ImGui::EndTabItem();
		}
		ImGui::EndTabBar();
	}
	ImGui::End();
}

// ============================ исходник ============================

void sourceWindow(App& a) {
	ImGui::Begin("Source");
	if (!a.hasSymbols()) { ImGui::TextDisabled("no symbols"); ImGui::End(); return; }

	// поиск функции по имени
	static char q[96] = "";
	ImGui::SetNextItemWidth(220);
	ImGui::InputTextWithHint("##fq", "find function...", q, sizeof(q));
	ImGui::SameLine();
	ImGui::Checkbox("follow live", &a.srcFollow);
	if (q[0]) {
		ImGui::BeginChild("found", ImVec2(0, 140), ImGuiChildFlags_Borders);
		int shown = 0;
		std::string lq = q;
		std::transform(lq.begin(), lq.end(), lq.begin(), ::tolower);
		for (int i = 0; i < a.syms.funcCount() && shown < 60; i++) {
			std::string n = a.syms.func(i).name;
			std::string ln = n;
			std::transform(ln.begin(), ln.end(), ln.begin(), ::tolower);
			if (ln.find(lq) == std::string::npos) continue;
			ImGui::PushID(i);
			if (ImGui::Selectable(n.c_str())) { a.showFunc(i); q[0] = 0; }
			ImGui::PopID();
			shown++;
		}
		ImGui::EndChild();
	}

	if (a.srcFile < 0) { ImGui::TextDisabled("click a function in Trace / Activity / call stacks"); ImGui::End(); return; }
	const std::string path = a.syms.resolve(a.srcFile);
	ImGui::Text("%s:%d   %s", a.syms.fileName(a.srcFile).c_str(), a.srcLine, a.syms.shortName(a.syms.funcAt(a.srcAddr)).c_str());
	const std::vector<std::string>* src = a.syms.source(a.srcFile);
	if (!src || src->empty()) {
		ImGui::TextColored(ImVec4(1, 0.6f, 0.3f, 1), "source not found (root: %s) - use --src-root", a.syms.root.c_str());
		ImGui::End();
		return;
	}
	ImGui::BeginChild("code", ImVec2(0, 0), 0, ImGuiWindowFlags_HorizontalScrollbar);
	const float lh = ImGui::GetTextLineHeightWithSpacing();
	if (a.srcScroll) {
		ImGui::SetScrollY(std::max(0.f, (a.srcLine - 1) * lh - ImGui::GetWindowHeight() * 0.35f));
		a.srcScroll = false;
	}
	ImGuiListClipper clip;
	clip.Begin((int)src->size(), lh);
	while (clip.Step())
		for (int i = clip.DisplayStart; i < clip.DisplayEnd; i++) {
			if (i + 1 == a.srcLine) {
				const ImVec2 p = ImGui::GetCursorScreenPos();
				ImGui::GetWindowDrawList()->AddRectFilled(p, ImVec2(p.x + ImGui::GetContentRegionAvail().x + 2000, p.y + lh),
					IM_COL32(90, 70, 20, 255));
			}
			ImGui::TextDisabled("%5d", i + 1);
			ImGui::SameLine();
			ImGui::TextUnformatted((*src)[i].c_str());
		}
	ImGui::EndChild();
	ImGui::End();
}

// ============================ лента активности ============================

void activityWindow(App& a) {
	ImGui::Begin("Activity");
	if (!a.hasSymbols()) { ImGui::TextDisabled("no symbols"); ImGui::End(); return; }
	ImGui::Checkbox("live trace", &a.liveTrace);
	ImGui::SameLine(); ImGui::SetNextItemWidth(120);
	ImGui::SliderInt("quiet frames", &a.activityGap, 10, 600);
	if (ImGui::IsItemHovered()) ImGui::SetTooltip("a function appears here when it is called after not being called for this many frames");
	ImGui::SameLine(); if (ImGui::SmallButton("clear")) a.feed.clear();
	if (!a.liveTrace) ImGui::TextDisabled("enable live trace: functions your actions start calling show up here as you play");
	ImGui::BeginChild("feed");
	ImGuiListClipper clip;
	clip.Begin((int)a.feed.size());
	while (clip.Step())
		for (int i = clip.DisplayStart; i < clip.DisplayEnd; i++) {
			const Activity& e = a.feed[i];
			char l[600];
			snprintf(l, sizeof(l), "%7u  %s   <- %s##%d", e.frame, a.syms.shortName(e.fn).c_str(), a.syms.shortName(e.caller).c_str(), i);
			if (ImGui::Selectable(l, a.view == (int64_t)e.frame)) a.showFunc(e.fn);
			if (ImGui::IsItemHovered()) ImGui::SetTooltip("%s\nclick: source, double-click: go to frame", a.syms.funcName(e.fn));
			if (ImGui::IsItemHovered() && ImGui::IsMouseDoubleClicked(0)) { a.pause(); a.seek(e.frame); a.showFunc(e.fn); }
		}
	ImGui::EndChild();
	ImGui::End();
}

} // namespace gbadbg
