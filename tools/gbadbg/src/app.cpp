#include "app.h"

#include <algorithm>
#include <cctype>

namespace gbadbg {

void App::stepLive(uint32_t keys) {
	const uint32_t f = hist.empty() ? 0 : hist.end();
	tmp.resize(emu.stateSize());
	emu.saveState(tmp.data());
	hist.record(f, tmp.data(), keys);
	views.beforeFrame(emu);
	emu.curFrame = f;
	if (liveTrace && hasSymbols()) {
		tracer.runFrame(emu, keys, true, trace);
		trace.frame = f;
		updateFeed(f);
	} else {
		emu.runFrame(keys, true);
	}
	view = f;
	if (emu.errorInFrame) {
		hist.setFlag(f, FF_ERROR, true);
		errorFrames.push_back(f);
		// Останавливаемся только на НОВОМ виде ошибки: если игра пишет одну и ту же ошибку каждый
		// кадр, иначе эмуляция встаёт навсегда. Вид = текст без шестнадцатеричных чисел (адресов).
		std::string first, sig;
		for (auto l = emu.log.rbegin(); l != emu.log.rend() && l->frame == f; ++l)
			if (l->isError()) first = l->text;
		for (size_t i = 0; i < first.size();) {
			size_t j = i;
			while (j < first.size() && isxdigit((unsigned char)first[j])) j++;
			if (j - i >= 4) { sig += '#'; i = j; }          // адрес/число -> #
			else { sig += first[i]; i++; }
		}
		if (pauseOnError && seenErrors.insert(sig).second) {
			pause();   // pause() сам трассирует кадр - стек в момент ошибки
			pauseReason = "error: " + first + "   (same kind of error won't pause again; Space = continue)";
		}
	}
}

// Показать кадр f: предсостояние f + кнопки f -> выполнить кадр (без звука и записи в лог).
// С символами кадр сразу трассируется: дерево вызовов и исходник соответствуют показанному кадру.
void App::seek(int64_t f) {
	if (hist.empty()) return;
	f = std::clamp<int64_t>(f, hist.first(), hist.end() - 1);
	view = f;
	if (autoTrace && hasSymbols()) { traceView(); }
	else {
		if (!hist.reconstruct((uint32_t)f, tmp)) return;
		emu.loadState(tmp.data());
		views.beforeFrame(emu);
		emu.replaying = true;
		emu.curFrame = (uint32_t)f;
		emu.runFrame(hist.keys((uint32_t)f), false);
		emu.replaying = false;
	}
	if (autoDiff) computeDiff();
}

void App::traceView(uint32_t watchAddr, uint32_t watchLen) {
	if (view < 0 || !hasSymbols() || !hist.reconstruct((uint32_t)view, tmp)) return;
	emu.loadState(tmp.data());
	views.beforeFrame(emu);
	emu.replaying = true;
	emu.curFrame = (uint32_t)view;
	tracer.runFrame(emu, hist.keys((uint32_t)view), false, trace, watchAddr, watchLen);
	emu.replaying = false;
	trace.frame = view;
	// ошибка в кадре - сразу показываем её место в исходнике
	for (const TraceEvent& e : trace.events)
		if (e.kind == TraceEvent::ERROR) { showAddr(e.pc); break; }
}

void App::pause() {
	paused = true;
	pauseReason = "paused";
	if (autoTrace && hasSymbols() && trace.frame != view) traceView();
	if (autoDiff) computeDiff();
}

void App::resume() {
	if (view >= 0 && !hist.empty() && view < (int64_t)hist.end() - 1) {
		hist.truncateAfter((uint32_t)view);
		emu.trimLogAfter((uint32_t)view);
		while (!errorFrames.empty() && errorFrames.back() > view) errorFrames.pop_back();
		for (auto it = marks.begin(); it != marks.end();) it = it->first > view ? marks.erase(it) : std::next(it);
		while (!feed.empty() && feed.front().frame > view) feed.pop_front();
	}
	paused = false;
	pauseReason.clear();
	diff.frame = -1;
}

void App::step(int delta, uint32_t liveKeys) {
	if (!paused) pause();
	if (delta > 0) {
		for (int i = 0; i < delta; i++) {
			if (view + 1 < (int64_t)hist.end()) { seek(view + 1); continue; }
			stepLive(liveKeys);   // конец истории - эмулируем новый кадр
			if (autoTrace && hasSymbols() && trace.frame != view) traceView();
		}
		if (autoDiff) computeDiff();
	} else {
		seek(view + delta);
	}
}

void App::computeDiff() {
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

void App::toggleMark() {
	if (view < 0) return;
	const uint32_t f = (uint32_t)view;
	if (marks.count(f)) { marks.erase(f); hist.setFlag(f, FF_BAD, false); }
	else { marks[f] = markNote; hist.setFlag(f, FF_BAD, true); markNote[0] = 0; }
}

void App::updateFeed(uint32_t f) {
	if ((int)lastSeen.size() != syms.funcCount()) lastSeen.assign(syms.funcCount(), 0xFFFFFFFFu);
	int newest = -1;
	for (const FlatRow& r : trace.flat) {
		if (r.fn < 0 || !r.calls) continue;
		uint32_t& ls = lastSeen[r.fn];
		if (ls == 0xFFFFFFFFu || f - ls > (uint32_t)activityGap) {
			feed.push_front({ f, r.fn, r.firstCaller });
			newest = r.fn;
		}
		ls = f;
	}
	while (feed.size() > 1000) feed.pop_back();
	if (newest >= 0 && srcFollow) showFunc(newest);
}

void App::showAddr(uint32_t addr) {
	int file, line;
	if (!syms.lineAt(addr, file, line)) return;
	srcFile = file;
	srcLine = line;
	srcAddr = addr;
	srcScroll = true;
}

void App::showFunc(int fn) {
	if (fn >= 0) showAddr(syms.func(fn).addr);
}

} // namespace gbadbg
