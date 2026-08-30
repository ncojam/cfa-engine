# Имя выходного файла программы
PROGNAME = contra_force_advance

# Toolchain (devkitARM). Переопределяемо через переменные окружения,
# например: make CXX=arm-none-eabi-g++
CXX      := arm-none-eabi-g++
OBJCOPY  ?= arm-none-eabi-objcopy
GBAFIX   ?= gbafix

# Раньше эти параметры задавались в devkitpro.bat и передавались через
# переменные окружения перед вызовом make. На Linux DEVKITARM/DEVKITPRO
# уже экспортированы глобально (см. fish-конфиг), поэтому флаги компиляции
# просто хранятся здесь.
PARAMS = -specs=gba.specs -mcpu=arm7tdmi -mtune=arm7tdmi
PARAMS += -fomit-frame-pointer -ffast-math -fno-rtti -fno-exceptions
PARAMS += -mthumb -mthumb-interwork -g0 -O2
PARAMS += -Iout -I..

# Список папок с исходниками (как в исходном Windows-Makefile)
SRC_DIRS = src src/music src/player src/npc
INCLUDES = -Isrc -Isrc/music -Isrc/player

# Собираем ВСЕ .cpp файлы с путями из всех SRC_DIRS
MODULES_CPP = $(foreach dir,$(SRC_DIRS),$(wildcard $(dir)/*.cpp))
# Объектные файлы: меняем src/xxx.cpp на out/xxx.o (сохраняя подпапки)
MODULES_O = $(patsubst src/%.cpp,out/%.o,$(MODULES_CPP))
MODULES_DEP = $(patsubst %.o,%.dep,$(MODULES_O))

# Правило поиска .cpp во всех подпапках
vpath %.cpp $(SRC_DIRS)

.PHONY: all dep clean
all: $(PROGNAME).gba

$(PROGNAME).gba: out/$(PROGNAME).elf
	$(OBJCOPY) -O binary out/$(PROGNAME).elf $(PROGNAME).gba
	$(GBAFIX) $(PROGNAME).gba

out/$(PROGNAME).elf: $(MODULES_O)
	$(CXX) $(PARAMS) $(INCLUDES) $(MODULES_O) -o out/$(PROGNAME).elf

out/%.o: %.cpp
	@mkdir -p $(dir $@)
	$(CXX) $(PARAMS) $(INCLUDES) -o $@ -c $<

dep: $(MODULES_DEP)

out/%.dep: %.cpp
	@mkdir -p $(dir $@)
	$(CXX) -MT $(patsubst %.dep,%.o,$@) -MM $(PARAMS) $(INCLUDES) $< > $@

-include $(MODULES_DEP)

clean:
	rm -f $(MODULES_O) $(MODULES_DEP)
	rm -f out/$(PROGNAME).elf $(PROGNAME).gba
