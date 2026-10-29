#include "navigation.h"
#include <stdlib.h>
void anka_edge_down(anka_edge_t *e, int x, int y, uint32_t now) {
    *e=(anka_edge_t){.x=x,.y=y,.start=now,.active=y<24||y>=456,.bottom=y>=456};
}
bool anka_edge_up(anka_edge_t *e, int x, int y, uint32_t now) {
    int dy=y-e->y;
    bool exit=e->active&&now-e->start<=1000&&abs(x-e->x)<=64&&
              (e->bottom?dy<=-96:dy>=96);
    e->active=false; return exit;
}
