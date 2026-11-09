#include "symbols.h"

#include <algorithm>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <filesystem>
#include <fstream>

namespace fs = std::filesystem;

namespace gbadbg {

static std::string shq(const std::string& s) {
	std::string r = "'";
	for (char c : s) { if (c == '\'') r += "'\\''"; else r += c; }
	return r + "'";
}

// Построчно читать вывод команды
template <class F>
static bool runLines(const std::string& cmd, F&& onLine) {
	FILE* p = popen((cmd + " 2>/dev/null").c_str(), "r");
	if (!p) return false;
	static char buf[8192];
	bool any = false;
	while (fgets(buf, sizeof(buf), p)) {
		size_t n = strlen(buf);
		while (n && (buf[n - 1] == '\n' || buf[n - 1] == '\r')) buf[--n] = 0;
		any = true;
		onLine(buf, n);
	}
	pclose(p);
	return any;
}

static bool isHex(const char* s, size_t n) {
	if (!n) return false;
	for (size_t i = 0; i < n; i++) if (!isxdigit((unsigned char)s[i])) return false;
	return true;
}

int Symbols::fileIndex(const std::string& path) {
	auto it = fileIds.find(path);
	if (it != fileIds.end()) return it->second;
	files.push_back(path);
	return fileIds[path] = (int)files.size() - 1;
}

bool Symbols::load(const std::string& elf, const std::string& srcRoot, const std::string& binutils, std::string& err) {
	elfPath = elf;
	if (!fs::exists(elf)) { err = "no ELF: " + elf; return false; }
	root = srcRoot;
	if (root.empty()) {
		fs::path d = fs::absolute(elf).parent_path();
		root = (d.filename() == "out" ? d.parent_path() : d).string();   // out/graveblood.elf -> корень игры
	}

	std::vector<std::string> prefixes;
	if (!binutils.empty()) prefixes.push_back(binutils);
	if (const char* dk = getenv("DEVKITARM")) prefixes.push_back(std::string(dk) + "/bin/arm-none-eabi-");
	prefixes.push_back("/opt/devkitpro/devkitARM/bin/arm-none-eabi-");
	prefixes.push_back("arm-none-eabi-");

	// ---- символы: nm -C -n -S ----
	std::string used;
	for (auto& pre : prefixes) {
		funcs.clear(); datas.clear();
		const bool ok = runLines(shq(pre + "nm") + " -C -n -S --defined-only " + shq(elf), [&](const char* l, size_t n) {
			// "08000234 0000004c T name(args)"  или  "08000234 T name"
			if (n < 11 || !isHex(l, 8) || l[8] != ' ') return;
			uint32_t addr = (uint32_t)strtoul(l, nullptr, 16), size = 0;
			const char* p = l + 9;
			if (isHex(p, 8) && p[8] == ' ') { size = (uint32_t)strtoul(p, nullptr, 16); p += 9; }
			const char type = p[0];
			if (!type || p[1] != ' ') return;
			const char* name = p + 2;
			if (!*name || name[0] == '$' || name[0] == '.') return;
			if (strchr("TtWw", type)) funcs.push_back({ addr & ~1u, size, name });
			else if (strchr("BbDdRrVvGgSsC", type)) datas.push_back({ addr, size, name });
		});
		if (ok && !funcs.empty()) { used = pre; break; }
	}
	if (funcs.empty()) { err = "nm failed - set DEVKITARM or --binutils <prefix>"; return false; }

	std::sort(funcs.begin(), funcs.end(), [](const Func& a, const Func& b) { return a.addr < b.addr; });
	funcs.erase(std::unique(funcs.begin(), funcs.end(), [](const Func& a, const Func& b) { return a.addr == b.addr; }), funcs.end());
	for (size_t i = 0; i < funcs.size(); i++) {
		if (!funcs[i].size && i + 1 < funcs.size()) funcs[i].size = funcs[i + 1].addr - funcs[i].addr;
		entry[funcs[i].addr] = (int)i;
	}
	std::sort(datas.begin(), datas.end(), [](const Data& a, const Data& b) { return a.addr < b.addr; });

	// ---- строки: objdump --dwarf=decodedline ----
	// Блоки «путь:» задают текущий файл, дальше строки «имя  строка  адрес  [view] [x]».
	int cur = -1;
	bool inLines = false;
	runLines(shq(used + "objdump") + " --wide --dwarf=decodedline " + shq(elf), [&](const char* l, size_t n) {
		if (!inLines) { if (strstr(l, "Contents of the .debug_line")) inLines = true; return; }
		if (!n) return;
		if (l[n - 1] == ':' && strncmp(l, "File name", 9) != 0) {
			std::string path(l, n - 1);
			if (path.rfind("CU: ", 0) == 0) path = path.substr(4);
			if (path.rfind("./", 0) == 0) path = path.substr(2);
			cur = fileIndex(path);
			return;
		}
		if (cur < 0 || !strncmp(l, "File name", 9)) return;
		char name[512], lineTok[32], addrTok[32];
		if (sscanf(l, "%511s %31s %31s", name, lineTok, addrTok) != 3) return;
		const uint32_t addr = (uint32_t)strtoul(addrTok, nullptr, 16);
		if (strncmp(addrTok, "0x", 2) != 0 && strcmp(addrTok, "0") != 0) return;
		const int line = lineTok[0] == '-' ? 0 : atoi(lineTok);   // '-' - конец последовательности
		if (addr >= 0x02000000) rows.push_back({ addr & ~1u, cur, line });   // адрес 0 - выброшенный линкером код
	});
	// одинаковый адрес - берём последнюю строку (как addr2line)
	std::stable_sort(rows.begin(), rows.end(), [](const Row& a, const Row& b) { return a.addr < b.addr; });
	std::vector<Row> uniq;
	for (const Row& r : rows) {
		if (!uniq.empty() && uniq.back().addr == r.addr) uniq.back() = r;
		else uniq.push_back(r);
	}
	rows.swap(uniq);
	if (rows.empty()) err = "no line info in ELF (build the game with -g)";
	printf("gbadbg: %zu functions, %zu data symbols, %zu line rows, %zu files (%s)\n",
		funcs.size(), datas.size(), rows.size(), files.size(), used.c_str());
	return true;
}

int Symbols::funcStart(uint32_t addr) const {
	auto it = entry.find(addr & ~1u);
	return it == entry.end() ? -1 : it->second;
}

int Symbols::funcAt(uint32_t addr) const {
	auto it = std::upper_bound(funcs.begin(), funcs.end(), addr, [](uint32_t a, const Func& f) { return a < f.addr; });
	if (it == funcs.begin()) return -1;
	--it;
	if (addr >= it->addr + std::max<uint32_t>(it->size, 2)) return -1;
	return (int)(it - funcs.begin());
}

std::string Symbols::shortName(int i) const {
	if (i < 0) return "[no symbol]";
	const std::string& n = funcs[i].name;
	const size_t p = n.find('(');
	return p == std::string::npos ? n : n.substr(0, p);
}

bool Symbols::lineAt(uint32_t addr, int& file, int& line) const {
	auto it = std::upper_bound(rows.begin(), rows.end(), addr, [](uint32_t a, const Row& r) { return a < r.addr; });
	if (it == rows.begin()) return false;
	--it;
	if (it->line <= 0) return false;
	file = it->file;
	line = it->line;
	return true;
}

std::string Symbols::where(uint32_t addr) const {
	int f, l;
	if (!lineAt(addr, f, l)) return "";
	return fs::path(files[f]).filename().string() + ":" + std::to_string(l);
}

uint32_t Symbols::findData(const std::string& name) const {
	for (const Data& d : datas) if (d.name == name) return d.addr;
	for (const Data& d : datas) if (d.name.find(name) != std::string::npos) return d.addr;
	for (const Func& f : funcs) if (f.name.find(name) != std::string::npos) return f.addr;
	return 0;
}

std::string Symbols::dataName(uint32_t addr) const {
	auto it = std::upper_bound(datas.begin(), datas.end(), addr, [](uint32_t a, const Data& d) { return a < d.addr; });
	if (it == datas.begin()) return "";
	--it;
	const uint32_t off = addr - it->addr;
	if (off >= std::max<uint32_t>(it->size, 1)) return "";
	if (!off) return it->name;
	char b[16];
	snprintf(b, sizeof(b), "+0x%X", off);
	return it->name + b;
}

void Symbols::indexRoot() {
	rootIndexed = true;
	std::error_code ec;
	for (auto it = fs::recursive_directory_iterator(root, fs::directory_options::skip_permission_denied, ec);
	     it != fs::recursive_directory_iterator(); it.increment(ec)) {
		if (ec) break;
		const std::string name = it->path().filename().string();
		if (it->is_directory(ec) && (name == ".git" || name == "out" || name == "build")) { it.disable_recursion_pending(); continue; }
		const std::string ext = it->path().extension().string();
		if (ext == ".cpp" || ext == ".h" || ext == ".hpp" || ext == ".c" || ext == ".inc")
			byBase.insert({ name, it->path().string() });
	}
}

std::string Symbols::resolve(int f) {
	auto it = resolved.find(f);
	if (it != resolved.end()) return it->second;
	const fs::path p(files[f]);
	std::string r;
	std::error_code ec;
	if (p.is_absolute() && fs::exists(p, ec)) r = p.string();
	else if (fs::exists(fs::path(root) / p, ec)) r = (fs::path(root) / p).string();
	else {
		if (!rootIndexed) indexRoot();
		auto range = byBase.equal_range(p.filename().string());
		for (auto i = range.first; i != range.second; ++i) {
			// предпочитаем путь, который заканчивается тем же хвостом
			if (r.empty() || (i->second.size() >= p.string().size() &&
			    i->second.compare(i->second.size() - p.string().size(), std::string::npos, p.string()) == 0))
				r = i->second;
		}
	}
	return resolved[f] = r;
}

const std::vector<std::string>* Symbols::source(int f) {
	auto it = sources.find(f);
	if (it != sources.end()) return &it->second;
	std::vector<std::string>& v = sources[f];
	const std::string path = resolve(f);
	std::ifstream in(path);
	std::string l;
	while (std::getline(in, l)) {
		if (!l.empty() && l.back() == '\r') l.pop_back();
		std::string t;   // табы -> 4 пробела (ImGui табуляцию не рисует)
		for (char c : l) { if (c == '\t') t += "    "; else t += c; }
		v.push_back(t);
	}
	return &v;
}

} // namespace gbadbg
