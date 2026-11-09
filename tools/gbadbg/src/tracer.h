// Трассировка кадра: ядро крутится по одной инструкции, по переходам PC восстанавливаем вызовы
// функций игры (по символам .elf). Получаем дерево вызовов, профиль по функциям, стек в момент
// ошибки ядра и «кто записал» в заданные байты памяти. Порядок выполнения повторяет
// mCore::runFrame один в один, поэтому трассированный кадр даёт то же состояние, что и обычный.
#pragma once
#include <cstdint>
#include <string>
#include <vector>

#include "emu.h"
#include "symbols.h"

namespace gbadbg {

struct StackPos { int fn; uint32_t addr; };   // функция и место в ней (PC / место вызова)

struct TraceEvent {
	enum Kind { ERROR, WRITE } kind;
	uint64_t step;                // номер инструкции в кадре
	uint32_t pc;                  // инструкция (для WRITE: та, что записала; 0 - DMA/прерывание)
	std::string text;
	std::vector<StackPos> stack;  // сверху вниз
};

struct TraceNode {
	int fn = -1, parent = -1;
	uint32_t calls = 0;
	uint64_t self = 0, incl = 0;  // такты
	std::vector<int> children;
};

struct FlatRow { int fn; uint32_t calls; uint64_t self; int firstCaller; };

struct Trace {
	int64_t frame = -1;
	uint64_t steps = 0, cycles = 0;       // инструкций и тактов кода игры (без простоя в halt)
	std::vector<TraceNode> nodes;         // [0] - корень (кадр)
	std::vector<FlatRow> flat;            // по функции, содержащей PC
	std::vector<TraceEvent> events;
	std::vector<StackPos> endStack;       // стек на конце кадра
	uint32_t watchAddr = 0, watchLen = 0;
};

class Tracer {
public:
	explicit Tracer(Symbols& s) : syms(s) {}
	// Выполнить кадр с трассировкой. watchLen > 0 - следить за записью в [watchAddr, +watchLen)
	void runFrame(Emu& emu, uint32_t keys, bool audio, Trace& out, uint32_t watchAddr = 0, uint32_t watchLen = 0);

private:
	struct Frame { int fn; uint32_t ret, sp; uint64_t enter; int node; };
	void branch(uint32_t pc, uint32_t prevNext, uint32_t lr, uint32_t sp);
	std::vector<StackPos> snapshot(uint32_t pc) const;

	Symbols& syms;
	Trace* t = nullptr;
	std::vector<Frame> stack;
	std::vector<int> flatIndex;           // fn+1 -> индекс в t->flat
	int curFn = -1;
	uint64_t clock = 0;
};

} // namespace gbadbg
