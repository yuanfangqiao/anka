#include "qr_pixels.h"
#include <string.h>
void anka_qr_pixels(const uint8_t *source,uint8_t *out,unsigned size,bool reverse) {
    if(size==640){
        if(reverse)for(unsigned i=0;i<640*640;i++)out[i]=source[640*640-1-i];
        else memcpy(out,source,640*640);
        return;
    }
    for(unsigned y=0;y<size;y++)for(unsigned x=0;x<size;x++){
        unsigned sx=x*2,sy=y*2,nx=2,ny=2;
        if(size==480){
            // Integer box sampling 4 -> 3: [0], average[1,2], [3].
            // A different sampling phase avoids LCD/sensor grid aliasing.
            static const unsigned offset[]={0,1,3};
            sx=x/3*4+offset[x%3];sy=y/3*4+offset[y%3];
            nx=x%3==1?2:1;ny=y%3==1?2:1;
        }
        unsigned sum=0;
        for(unsigned j=0;j<ny;j++)for(unsigned i=0;i<nx;i++)sum+=source[(sy+j)*640+sx+i];
        unsigned index=y*size+x;
        out[reverse?size*size-1-index:index]=(sum+nx*ny/2)/(nx*ny);
    }
}
