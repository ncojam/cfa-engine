// История кадров для перемотки.
//
// На каждый кадр f храним «предсостояние» (state ДО выполнения кадра f) и кнопки кадра f.
// Хранится не всё состояние, а XOR с предыдущим кадром, сжатый по нулям (меняется обычно
// несколько КБ из ~400). Каждые keyEvery кадров - ключевой кадр (полное состояние, тоже сжатое),
// от него можно восстановить любой кадр. Чтобы показать кадр f: загрузить предсостояние f,
// нажать кнопки f и выполнить кадр - эмуляция детерминирована, картинка и память будут теми же.
#pragma once
#include <cstdint>
#include <deque>
#include <vector>

namespace gbadbg {

enum FrameFlag : uint8_t {
	FF_ERROR = 1,       // в кадре была ошибка ядра (bad memory, invalid jump...)
	FF_BAD = 2,         // помечен пользователем как «плохой»
};

class History {
public:
	void init(size_t stateBytes, size_t budgetBytes, int keyEvery = 60);
	void clear(uint32_t firstFrame);

	// Записать кадр f (f должен быть == end()): предсостояние и кнопки
	void record(uint32_t f, const void* prestate, uint32_t keys);
	// Восстановить предсостояние кадра f в out (размер stateBytes). false - кадра нет.
	bool reconstruct(uint32_t f, std::vector<uint8_t>& out);
	// Оставить кадры <= f (продолжение игры с прошлого кадра стирает «будущее")
	void truncateAfter(uint32_t f);

	bool has(uint32_t f) const { return f >= base && f < base + frames.size(); }
	uint32_t first() const { return base; }
	uint32_t end() const { return base + (uint32_t)frames.size(); }
	bool empty() const { return frames.empty(); }
	uint32_t keys(uint32_t f) const { return has(f) ? frames[f - base].keys : 0; }
	uint8_t flags(uint32_t f) const { return has(f) ? frames[f - base].flags : 0; }
	void setFlag(uint32_t f, uint8_t fl, bool on);

	size_t bytes() const { return total; }
	size_t budget() const { return budgetBytes; }
	void setBudget(size_t b) { budgetBytes = b; trim(); }

private:
	struct Frame {
		uint32_t keys = 0;
		uint8_t flags = 0;
		std::vector<uint32_t> delta;   // XOR с предсостоянием f-1 (у самого первого - пусто)
		std::vector<uint32_t> full;    // ключевой кадр: полное предсостояние
		size_t size() const { return (delta.capacity() + full.capacity()) * 4 + sizeof(Frame); }
	};
	void trim();
	static void encode(const uint32_t* cur, const uint32_t* prev, size_t words, std::vector<uint32_t>& out);
	static void applyXor(const std::vector<uint32_t>& code, uint32_t* buf, size_t words);

	std::deque<Frame> frames;
	uint32_t base = 0;
	size_t words = 0, stateBytes = 0, total = 0, budgetBytes = 0;
	int keyEvery = 60;
	std::vector<uint32_t> last;            // предсостояние последнего записанного кадра
	// кэш последнего восстановления: шаг на кадр вперёд/назад - один XOR
	std::vector<uint32_t> cache;
	int64_t cacheFrame = -1;
};

} // namespace gbadbg
