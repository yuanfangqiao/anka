#pragma once
#include <stdbool.h>
#include <stdint.h>
typedef struct { int x,y; uint32_t start; bool active, bottom; } anka_edge_t;
void anka_edge_down(anka_edge_t *edge, int x, int y, uint32_t now);
bool anka_edge_up(anka_edge_t *edge, int x, int y, uint32_t now);
