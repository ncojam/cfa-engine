# Имя выходного файла программы
PROGNAME = contra_force_advance

# Toolchain (devkitARM). Переопределяемо через переменные окружения,
# например: make CXX=arm-none-eabi-g++
CXX      ?= arm-none-eabi-g++
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

# Выделяем из .cpp файлов в src/ чистый список имён модулей без путей и расширений
MODULES = $(patsubst %.cpp,%,$(notdir $(wildcard src/*.cpp)))
# Подготавливаем списки модулей по типам, добавляя имя подпапок впереди и расширения в конце
MODULES_CPP = $(addsuffix .cpp,$(addprefix src/,$(MODULES)))
MODULES_O = $(addsuffix .o,$(addprefix out/,$(MODULES)))
MODULES_DEP = $(addsuffix .dep,$(addprefix out/,$(MODULES)))

.PHONY: all dep clean
all: $(PROGNAME).gba

$(PROGNAME).gba: out/$(PROGNAME).elf
	$(OBJCOPY) -O binary out/$(PROGNAME).elf $(PROGNAME).gba
	$(GBAFIX) $(PROGNAME).gba

out/$(PROGNAME).elf: $(MODULES_O)
	$(CXX) $(PARAMS) $(MODULES_O) -o out/$(PROGNAME).elf

out/%.o: src/%.cpp | out
	$(CXX) $(PARAMS) -o $@ -c $<

out: ; mkdir -p out

dep: $(MODULES_DEP)

out/%.dep: src/%.cpp | out
	$(CXX) -MT $(patsubst %.dep,%.o,$@) -MM $(PARAMS) $< > $@

-include $(MODULES_DEP)

clean:
	rm -f out/*.elf out/*.dep out/*.o out/*.s out/*.inc
