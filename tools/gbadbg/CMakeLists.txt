cmake_minimum_required(VERSION 3.20)
project(gbadbg C CXX)

# gbadbg - отладчик Graveblood на ядре mGBA (libmgba) + SDL2 + Dear ImGui.
# Сборка:  cmake -B build -DCMAKE_BUILD_TYPE=Release && cmake --build build -j
# mGBA и ImGui скачиваются при первой конфигурации (FetchContent), системные зависимости:
# cmake, gcc, git, sdl2 (sdl2-compat), mesa/libGL.

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
if(NOT CMAKE_BUILD_TYPE)
	set(CMAKE_BUILD_TYPE Release)
endif()

include(FetchContent)

# CMake 4 убрал совместимость с cmake_minimum_required < 3.5, а у mGBA 0.10.5 стоит старая версия.
# Переменная действует и на подпроекты из FetchContent.
set(CMAKE_POLICY_VERSION_MINIMUM 3.5 CACHE STRING "" FORCE)

# ---- mGBA: только библиотека (LIBMGBA_ONLY), без фронтендов и внешних зависимостей ----
set(LIBMGBA_ONLY ON CACHE BOOL "" FORCE)
set(M_CORE_GBA ON CACHE BOOL "" FORCE)
set(M_CORE_GB OFF CACHE BOOL "" FORCE)
FetchContent_Declare(mgba
	GIT_REPOSITORY https://github.com/mgba-emu/mgba.git
	GIT_TAG 0.10.5
	GIT_SHALLOW TRUE)
FetchContent_MakeAvailable(mgba)

# ---- Dear ImGui (docking) ----
FetchContent_Declare(imgui
	GIT_REPOSITORY https://github.com/ocornut/imgui.git
	GIT_TAG v1.91.9b-docking
	GIT_SHALLOW TRUE)
FetchContent_MakeAvailable(imgui)

find_package(SDL2 REQUIRED)
find_package(OpenGL REQUIRED)

add_library(imgui STATIC
	${imgui_SOURCE_DIR}/imgui.cpp
	${imgui_SOURCE_DIR}/imgui_draw.cpp
	${imgui_SOURCE_DIR}/imgui_tables.cpp
	${imgui_SOURCE_DIR}/imgui_widgets.cpp
	${imgui_SOURCE_DIR}/backends/imgui_impl_sdl2.cpp
	${imgui_SOURCE_DIR}/backends/imgui_impl_opengl3.cpp)
target_include_directories(imgui PUBLIC ${imgui_SOURCE_DIR} ${imgui_SOURCE_DIR}/backends)
target_link_libraries(imgui PUBLIC SDL2::SDL2 OpenGL::GL ${CMAKE_DL_LIBS})

add_executable(gbadbg
	src/main.cpp
	src/app.cpp
	src/ui.cpp
	src/emu.cpp
	src/history.cpp
	src/views.cpp
	src/symbols.cpp
	src/tracer.cpp)
target_compile_definitions(gbadbg PRIVATE BUILD_STATIC)
target_link_libraries(gbadbg PRIVATE mgba imgui SDL2::SDL2 OpenGL::GL)
