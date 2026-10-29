#include "imu_calibration.h"
#include "controller_layout.h"
#include "orientation.h"
#include <math.h>
#include <string.h>
static void window(anka_calibration_t *c) {
    c->samples=c->progress=c->began=0;
    memset(c->sum,0,sizeof(c->sum));memset(c->square,0,sizeof(c->square));
    memset(c->acceleration,0,sizeof(c->acceleration));
    memset(c->turn,0,sizeof(c->turn));c->previous=0;
}
static void idle_bias(anka_calibration_t *c,const float gyro[3]) {
    for(unsigned i=0;i<3;i++){c->idle_sum[i]+=gyro[i];c->idle_square[i]+=gyro[i]*gyro[i];}
    if(++c->idle_samples<120)return;
    float variance=0,speed=0,mean[3];
    for(unsigned i=0;i<3;i++){
        mean[i]=c->idle_sum[i]/c->idle_samples;
        variance+=fmaxf(0,c->idle_square[i]/c->idle_samples-mean[i]*mean[i]);speed+=fabsf(mean[i]);
    }
    if(variance<.5f&&speed<3){memcpy(c->bias,mean,sizeof(mean));c->bias_valid=true;}
    c->idle_samples=0;memset(c->idle_sum,0,sizeof(c->idle_sum));memset(c->idle_square,0,sizeof(c->idle_square));
}
void anka_calibration_bind(anka_calibration_t *c) {
    if(c->bound)return;
    float bias[3];memcpy(bias,c->bias,sizeof(bias));bool valid=c->bias_valid;
    memset(c,0,sizeof(*c));memcpy(c->bias,bias,sizeof(bias));c->bias_valid=valid;c->bound=true;c->phase=CAL_WAIT;
}
void anka_calibration_step(anka_calibration_t *c,const float gyro[3],const float accel[3],
                           unsigned chord,bool connected,bool available,uint32_t now) {
    if(c->phase==CAL_READY)return;
    if(available&&(!c->bound||(c->phase==CAL_WAIT&&chord==0))){
        bool finite=true;for(unsigned i=0;i<3;i++)if(!isfinite(gyro[i]))finite=false;
        if(finite)idle_bias(c,gyro);
    }
    if(!c->bound)return;
    if(!connected){window(c);c->neutral_seen=false;c->phase=CAL_WAIT;return;}
    if(!available){window(c);c->phase=CAL_NO_IMU;return;}
    for(unsigned i=0;i<3;i++)if(!isfinite(gyro[i])||!isfinite(accel[i])){
        window(c);c->phase=CAL_NO_IMU;return;
    }
    if(c->phase==CAL_RELEASE){
        if(chord==0){
            const float up[]={0,1,0},right[]={1,0,0};
            anka_quat_t basis=anka_orientation_basis(accel);
            anka_quat_rotate(basis,up,c->up);anka_quat_rotate(basis,right,c->right);
            c->phase=CAL_READY;c->ready_at=now;
        }
        return;
    }
    if(chord==0)c->neutral_seen=true;
    if(chord==3)c->last_both=now;
    bool grace=c->samples&&now-c->last_both<=150;
    if((chord!=3&&!grace)||!c->neutral_seen){window(c);c->phase=CAL_WAIT;return;}
    if(!c->samples)c->began=now;
    c->phase=CAL_HOLD;++c->samples;
    c->progress=(now-c->began)*100/800;if(c->progress>100)c->progress=100;
    // This gesture selects a reference, not a stationary sensor certification.
    // Any grip, including a flat screen, is valid. Actual reference is captured on release.
    if(c->samples>=20&&now-c->began>=800&&chord==3){c->phase=CAL_RELEASE;c->progress=100;}
}
bool anka_calibration_project(const anka_calibration_t *c,const float gyro[3],float *yaw,float *pitch) {
    *yaw=*pitch=0;if(c->phase!=CAL_READY)return false;
    for(unsigned i=0;i<3;i++){
        if(!isfinite(gyro[i]))return false;
        float value=gyro[i]-c->bias[i];*yaw+=value*c->up[i];*pitch+=value*c->right[i];
    }
    return true;
}
unsigned anka_calibration_hit(int x,int y) {
    // Inverse of the page's clockwise90-degree transform around(240,240).
    int logical_x,logical_y;anka_controller_point(x,y,&logical_x,&logical_y);
    if(logical_y<164||logical_y>=336)return 0;
    if(logical_x>=20&&logical_x<236)return 1;
    return logical_x>=244&&logical_x<460?2:0;
}
