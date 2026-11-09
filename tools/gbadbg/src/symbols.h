// Символы и строки исходников из .elf игры.
// Читаем через binutils devkitARM (arm-none-eabi-nm -C, arm-none-eabi-objdump --dwarf=decodedline):
// так получаем сразу разобранные C++ имена и таблицу строк DWARF любой версии.
#pragma once
#include <cstdint>
#include <map>
#include <string>
#include <unordered_map>
#include <vector>

namespace gbadbg {

class Symbols {
public:
	struct Func { uint32_t addr, size; std::string name; };
	struct Data { uint32_t addr, size; std::string name; };

	// binutils: путь-префикс вида "/opt/devkitpro/devkitARM/bin/arm-none-eabi-" (пусто - искать сам)
	bool load(const std::string& elf, const std::string& srcRoot, const std::string& binutils, std::string& err);
	bool loaded() const { return !funcs.empty(); }

	int funcStart(uint32_t addr) const;          // функция, НАЧИНАЮЩАЯСЯ по адресу (вход), или -1
	int funcAt(uint32_t addr) const;             // функция, СОДЕРЖАЩАЯ адрес, или -1
	const Func& func(int i) const { return funcs[i]; }
	int funcCount() const { return (int)funcs.size(); }
	const char* funcName(int i) const { return i >= 0 ? funcs[i].name.c_str() : "[no symbol]"; }
	std::string shortName(int i) const;          // без списка аргументов

	bool lineAt(uint32_t addr, int& file, int& line) const;
	std::string where(uint32_t addr) const;      // "player_interaction.cpp:123"
	std::string dataName(uint32_t addr) const;   // "relationLVLS+0x10" или ""

	const std::string& fileName(int f) const { return files[f]; }
	int fileCount() const { return (int)files.size(); }
	std::string resolve(int f);                   // путь к существующему файлу или ""
	const std::vector<std::string>* source(int f); // строки файла (кэш)

	std::string elfPath, root;

private:
	struct Row { uint32_t addr; int file; int line; };
	int fileIndex(const std::string& path);
	void indexRoot();

	std::vector<Func> funcs;                      // по адресу
	std::unordered_map<uint32_t, int> entry;
	std::vector<Data> datas;                      // по адресу
	std::vector<Row> rows;                        // по адресу
	std::vector<std::string> files;
	std::unordered_map<std::string, int> fileIds;
	std::map<int, std::string> resolved;
	std::map<int, std::vector<std::string>> sources;
	std::multimap<std::string, std::string> byBase; // имя файла -> полный путь (поиск по root)
	bool rootIndexed = false;
};

} // namespace gbadbg
