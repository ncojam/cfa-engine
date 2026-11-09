#include "history.h"

#include <cstdlib>
#include <cstring>

namespace gbadbg {

void History::init(size_t stateBytes_, size_t budget, int keyEvery_) {
	stateBytes = stateBytes_;
	words = (stateBytes + 3) / 4;
	budgetBytes = budget;
	keyEvery = keyEvery_ > 0 ? keyEvery_ : 60;
	clear(0);
}

void History::clear(uint32_t firstFrame) {
	frames.clear();
	base = firstFrame;
	total = 0;
	last.assign(words, 0);
	cacheFrame = -1;
}

// Формат: [пропуск слов][N][N слов XOR] ... Нулевые слова XOR (не изменилось) не храним.
void History::encode(const uint32_t* cur, const uint32_t* prev, size_t n, std::vector<uint32_t>& out) {
	out.clear();
	size_t i = 0, lastEnd = 0;
	auto x = [&](size_t k) { return prev ? (cur[k] ^ prev[k]) : cur[k]; };
	while (i < n) {
		while (i < n && x(i) == 0) i++;
		if (i >= n) break;
		const size_t start = i;
		// литерал тянем через короткие (<=2 слов) нулевые разрывы - заголовок стоит 2 слова
		size_t endLit = i;
		while (i < n) {
			if (x(i) != 0) { endLit = ++i; continue; }
			size_t z = i;
			while (z < n && x(z) == 0 && z - i < 3) z++;
			if (z < n && z - i < 3 && x(z) != 0) { i = z; continue; }
			break;
		}
		out.push_back((uint32_t)(start - lastEnd));
		out.push_back((uint32_t)(endLit - start));
		for (size_t k = start; k < endLit; k++) out.push_back(x(k));
		lastEnd = endLit;
		i = endLit;
	}
}

void History::applyXor(const std::vector<uint32_t>& code, uint32_t* buf, size_t n) {
	size_t pos = 0, i = 0;
	while (i + 1 < code.size()) {
		pos += code[i];
		const uint32_t cnt = code[i + 1];
		i += 2;
		for (uint32_t k = 0; k < cnt && pos < n && i < code.size(); k++) buf[pos++] ^= code[i++];
	}
}

void History::record(uint32_t f, const void* prestate, uint32_t keys) {
	if (frames.empty()) base = f;
	if (f != end()) { truncateAfter(f - 1); if (frames.empty()) base = f; }

	static std::vector<uint32_t> cur, scratch;
	cur.assign(words, 0);
	memcpy(cur.data(), prestate, stateBytes);

	Frame fr;
	fr.keys = keys;
	if (!frames.empty()) {
		encode(cur.data(), last.data(), words, scratch);
		fr.delta.assign(scratch.begin(), scratch.end());
	}
	if (frames.empty() || (f % (uint32_t)keyEvery) == 0) {
		encode(cur.data(), nullptr, words, scratch);
		fr.full.assign(scratch.begin(), scratch.end());
	}
	last.swap(cur);
	total += fr.size();
	frames.push_back(std::move(fr));
	trim();
}

void History::trim() {
	while (total > budgetBytes && frames.size() > (size_t)keyEvery * 2) {
		do {
			total -= frames.front().size();
			frames.pop_front();
			base++;
		} while (!frames.empty() && frames.front().full.empty());
	}
	if (cacheFrame >= 0 && (uint32_t)cacheFrame < base) cacheFrame = -1;
}

bool History::reconstruct(uint32_t f, std::vector<uint8_t>& out) {
	if (!has(f)) return false;
	uint32_t k = f;
	while (frames[k - base].full.empty()) k--;          // ближайший ключевой кадр (frames[0] - всегда ключевой)
	const bool useCache = cacheFrame >= 0 && has((uint32_t)cacheFrame) &&
		(uint32_t)std::llabs((int64_t)f - cacheFrame) <= f - k;
	if (!useCache) {
		cache.assign(words, 0);
		applyXor(frames[k - base].full, cache.data(), words);
		cacheFrame = k;
	}
	// delta[j] = pre[j] ^ pre[j-1]: вперёд и назад - один и тот же XOR
	while ((uint32_t)cacheFrame < f) { cacheFrame++; applyXor(frames[cacheFrame - base].delta, cache.data(), words); }
	while ((uint32_t)cacheFrame > f) { applyXor(frames[cacheFrame - base].delta, cache.data(), words); cacheFrame--; }
	out.resize(stateBytes);
	memcpy(out.data(), cache.data(), stateBytes);
	return true;
}

void History::truncateAfter(uint32_t f) {
	if (frames.empty()) return;
	if (f < base) { clear(base); return; }
	while (end() - 1 > f) {
		total -= frames.back().size();
		frames.pop_back();
	}
	std::vector<uint8_t> tmp;
	reconstruct(f, tmp);
	last.assign(words, 0);
	memcpy(last.data(), tmp.data(), stateBytes);
}

void History::setFlag(uint32_t f, uint8_t fl, bool on) {
	if (!has(f)) return;
	if (on) frames[f - base].flags |= fl;
	else frames[f - base].flags &= ~fl;
}

} // namespace gbadbg
