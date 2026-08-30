// safe_mem.h
#ifndef SAFE_MEM_H
#define SAFE_MEM_H

#include "gba_defs.h"

inline bool isSafeRamAddr(const volatile void* p)
{
    u32 a = (u32)p;
    // EWRAM
    if (a >= EW_RAM_START && a < EW_RAM_START + EW_RAM_SIZE) return true;
    // IWRAM, но с исключением зарезервированных 8 байт BIOS в самом верху
    if (a >= IW_RAM_START && a < IW_RAM_START + IW_RAM_SIZE)
    {
        return a < 0x3007FF8;   // не даём лезть в BIOS_WAIT_FLAG / REG_INTERRUPT и стек прямо над ними
    }
    // VRAM — добавить, иначе cursorWrite не сможет писать ни один пиксель текста
    if (a >= VID_RAM_START && a < VID_RAM_START + VID_RAM_SIZE) return true;
    return false;
}

template<typename T>
inline bool safeWrite(volatile T* addr, T value)
{
    if (!isSafeRamAddr(addr)) return false;  // отказ вместо порчи памяти
    *addr = value;
    return true;
}

#endif
