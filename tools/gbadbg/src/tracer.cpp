#include "tracer.h"

#include <algorithm>
#include <cstring>

#include <mgba/core/core.h>
#include <mgba/core/timing.h>
#include <mgba/internal/arm/arm.h>
#include <mgba/internal/gba/gba.h>

namespace gbadbg {

static int childOf(Trace& t, int node, int fn) {
	for (int c : t.nodes[node].children)
		if (t.nodes[c].fn == fn) return c;
	TraceNode n;
	n.fn = fn;
	n.parent = node;
	t.nodes.push_back(n);
	t.nodes[node].children.push_back((int)t.nodes.size() - 1);
	return (int)t.nodes.size() - 1;
}

std::vector<StackPos> Tracer::snapshot(uint32_t pc) const {
	std::vector<StackPos> s;
	s.push_back({ syms.funcAt(pc), pc });
	// у каждого кадра стека место - адрес вызова (адрес возврата из кадра выше минус 2)
	for (int i = (int)stack.size() - 1; i >= 0; i--)
		s.push_back({ syms.funcAt(stack[i].ret - 2), stack[i].ret - 2 });
	return s;
}

void Tracer::popTop() {
	const Frame& f = stack.back();
	t->nodes[f.node].incl += clock - f.enter;
	stack.pop_back();
}

// user и system - один банк регистров (один стек)
static unsigned stackBank(unsigned mode) { return mode == 0x1F ? 0x10 : mode; }

// PC ушёл не на следующую инструкцию: возврат, вызов или переход
void Tracer::branch(uint32_t pc, uint32_t prevNext, uint32_t lr, uint32_t sp, unsigned mode) {
	mode = stackBank(mode);
	// возврат: ищем кадр с этим адресом возврата не только на вершине - если возврат из какой-то
	// функции пропустили, он снимется здесь вместе с ней (и хвостовые вызовы - заодно)
	for (int i = (int)stack.size() - 1, k = 0; i >= 0 && k < 64; i--, k++) {
		const Frame& f = stack[i];
		if (f.ret == pc && f.mode == mode && sp >= f.sp)
			while ((int)stack.size() > i) popTop();
	}
	// кадры того же стека, вошедшие при SP ниже текущего, уже завершились (SP поднялся выше)
	while (!stack.empty() && stack.back().mode == mode && stack.back().sp < sp) popTop();
	const int fn = syms.funcStart(pc);
	const int prevFn = curFn;
	curFn = syms.funcAt(pc);
	if (fn < 0) return;
	// вход в функцию: настоящий вызов (LR = следующая за вызовом инструкция) или переход в другую функцию
	if ((lr & ~1u) != prevNext && fn == prevFn) return;   // цикл на начало своей же функции
	const int parentNode = stack.empty() ? 0 : stack.back().node;
	const int node = childOf(*t, parentNode, fn);
	t->nodes[node].calls++;
	if (stack.size() >= 512) stack.erase(stack.begin());   // защита от разбегания
	stack.push_back({ fn, lr & ~1u, sp, clock, node, mode });
	int& fi = flatIndex[fn + 1];
	if (fi < 0) { fi = (int)t->flat.size(); t->flat.push_back({ fn, 0, 0, stack.size() > 1 ? stack[stack.size() - 2].fn : prevFn }); }
	t->flat[fi].calls++;
}

void Tracer::runFrame(Emu& emu, uint32_t keys, bool audio, Trace& out, uint32_t watchAddr, uint32_t watchLen) {
	mCore* core = emu.core;
	GBA* gba = (GBA*)core->board;
	ARMCore* cpu = (ARMCore*)core->cpu;

	out = Trace();
	out.watchAddr = watchAddr;
	out.watchLen = watchLen;
	out.nodes.push_back(TraceNode());
	t = &out;
	stack.clear();
	flatIndex.assign(syms.funcCount() + 1, -1);
	clock = 0;

	// наблюдение за памятью
	uint8_t* wp = nullptr;
	if (watchLen) {
		size_t sz = 0;
		uint8_t* base = emu.mem((Region)(watchAddr >> 24), &sz);
		const uint32_t off = watchAddr & 0xFFFFFF;
		if (base && off < sz) { wp = base + off; watchLen = std::min<uint32_t>(watchLen, (uint32_t)(sz - off)); }
	}
	std::vector<uint8_t> shadow(wp ? wp : nullptr, wp ? wp + watchLen : nullptr);
	auto checkWatch = [&](uint32_t pc) {
		if (!wp || !memcmp(wp, shadow.data(), watchLen)) return;
		char buf[200];
		int k = 0;
		for (uint32_t i = 0; i < watchLen && k < 8; i++)
			if (wp[i] != shadow[i]) {
				if (!k) snprintf(buf, sizeof(buf), "%08X: %02X -> %02X", watchAddr + i, shadow[i], wp[i]);
				k++;
			}
		std::string text = buf;
		if (k > 1) text += "  (+" + std::to_string(k - 1) + " more bytes)";
		if (!pc) text += "  [DMA / interrupt / event]";
		out.events.push_back({ TraceEvent::WRITE, out.steps, pc, text, snapshot(pc ? pc : (uint32_t)cpu->gprs[15]) });
		memcpy(shadow.data(), wp, watchLen);
	};

	uint32_t lastPc = 0;
	emu.errorHook = [&](int, const char* text) {
		out.events.push_back({ TraceEvent::ERROR, out.steps, lastPc, text, snapshot(lastPc) });
	};

	emu.beginFrame(keys);
	// == _GBACoreRunFrame + ARMRunLoop, только по одной инструкции
	const uint32_t frameCounter = gba->video.frameCounter;
	const uint32_t startCycle = mTimingCurrentTime(&gba->timing);
	uint32_t expect = 0xFFFFFFFF;
	curFn = -1;
	while (gba->video.frameCounter == frameCounter && mTimingCurrentTime(&gba->timing) - startCycle < VIDEO_TOTAL_LENGTH + VIDEO_HORIZONTAL_LENGTH) {
		while (cpu->cycles < cpu->nextEvent) {
			const uint32_t len = cpu->cpsr.t ? 2 : 4;
			// до шага gprs[PC] = инструкция + длина (prefetch[0]); во время её выполнения будет +2*длина
			const uint32_t pc = (uint32_t)cpu->gprs[ARM_PC] - len;
			if (pc != expect) branch(pc, expect, (uint32_t)cpu->gprs[ARM_LR], (uint32_t)cpu->gprs[ARM_SP], cpu->cpsr.priv);
			lastPc = pc;
			const int32_t c0 = cpu->cycles;
			ARMRun(cpu);
			const uint64_t dc = (uint64_t)(cpu->cycles - c0);
			clock += dc;
			out.steps++;
			// профиль: такты - функции, содержащей PC
			int& fi = flatIndex[curFn + 1];
			if (fi < 0) { fi = (int)out.flat.size(); out.flat.push_back({ curFn, 0, 0, -1 }); }
			out.flat[fi].self += dc;
			out.nodes[stack.empty() ? 0 : stack.back().node].self += dc;
			expect = pc + len;
			if (wp) checkWatch(pc);
		}
		cpu->irqh.processEvents(cpu);
		if (wp) checkWatch(0);
	}
	emu.endFrame(audio);
	emu.errorHook = nullptr;

	for (const Frame& f : stack) out.nodes[f.node].incl += clock - f.enter;
	out.nodes[0].incl = clock;
	out.cycles = clock;
	out.endStack = snapshot(lastPc);
	// корень и узлы без входа: incl >= self
	for (auto& n : out.nodes) if (n.incl < n.self) n.incl = n.self;
	std::sort(out.flat.begin(), out.flat.end(), [](const FlatRow& a, const FlatRow& b) { return a.self > b.self; });
	t = nullptr;
}

} // namespace gbadbg
