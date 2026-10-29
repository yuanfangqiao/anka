#include "imu_calibration.h"
#include <assert.h>
#include <math.h>
#include <string.h>
static const float bias[]={.2f,-.1f,.05f};
static void hold(anka_calibration_t *c,const float a[3]) {
    anka_calibration_step(c,bias,a,0,true,true,1);
    for(unsigned i=0;i<170;i++)anka_calibration_step(c,bias,a,3,true,true,10+i*5);
}
void calibration_tests(void) {
    const float poses[][3]={{0,1,0},{1,0,0},{0,-1,0},{-1,0,0},{.7071068f,.7071068f,0},{.6f,0,.8f},{0,0,1},{0,0,-1}};
    for(unsigned p=0;p<sizeof(poses)/sizeof(poses[0]);p++){
        anka_calibration_t c={0};float yaw,pitch;
        hold(&c,poses[p]);assert(!c.bound&&c.phase!=CAL_READY);
        anka_calibration_bind(&c);
        // A chord already held while binding is never treated as consent.
        for(unsigned i=0;i<200;i++)anka_calibration_step(&c,bias,poses[p],3,true,true,i*5);
        assert(c.phase==CAL_WAIT);
        for(unsigned i=0;i<200;i++)anka_calibration_step(&c,bias,poses[p],i&1?1:2,true,true,i*5);
        assert(c.phase==CAL_WAIT);
        hold(&c,poses[p]);assert(c.phase==CAL_RELEASE&&c.progress==100);
        assert(!anka_calibration_project(&c,bias,&yaw,&pitch));
        anka_calibration_step(&c,bias,poses[p],1,true,true,1000);assert(c.phase==CAL_RELEASE);
        anka_calibration_step(&c,bias,poses[p],0,true,true,1005);assert(c.phase==CAL_READY);
        assert(anka_calibration_project(&c,bias,&yaw,&pitch));assert(fabsf(yaw)<.001f&&fabsf(pitch)<.001f);
        float gyro[3];for(unsigned i=0;i<3;i++)gyro[i]=bias[i]+3*c.up[i]+2*c.right[i];
        assert(anka_calibration_project(&c,gyro,&yaw,&pitch));
        assert(fabsf(yaw-3)<.001f&&fabsf(pitch-2)<.001f);
        anka_calibration_t previous=c;anka_calibration_bind(&c);
        assert(!memcmp(&previous,&c,sizeof(c))); // Reconnect preserves the playing reference.
        anka_calibration_step(&c,bias,poses[p],0,false,true,2000);assert(c.phase==CAL_READY);
    }
    anka_calibration_t c={0};anka_calibration_bind(&c);
    const float flat[]={0,0,1};hold(&c,flat);assert(c.phase==CAL_RELEASE);
    anka_calibration_bind(&c);assert(c.phase==CAL_RELEASE);
    c=(anka_calibration_t){0};anka_calibration_bind(&c);
    anka_calibration_step(&c,bias,poses[0],0,true,true,0);
    for(unsigned i=0;i<162;i++){
        float moving[]={80,0,0};
        anka_calibration_step(&c,moving,poses[0],3,true,true,1+i*5);
    }
    assert(c.phase==CAL_RELEASE);
    anka_calibration_step(&c,bias,poses[0],3,false,true,2000);assert(c.phase==CAL_WAIT&&!c.neutral_seen);
    anka_calibration_step(&c,bias,poses[0],0,true,false,2100);assert(c.phase==CAL_NO_IMU);
    assert(anka_calibration_hit(306,30)==1&&anka_calibration_hit(155,449)==2);
    assert(!anka_calibration_hit(240,240)&&!anka_calibration_hit(100,330));
    // Natural tremor is accepted without teaching it as a constant gyro bias.
    c=(anka_calibration_t){0};
    for(unsigned i=0;i<120;i++)anka_calibration_step(&c,bias,poses[0],0,false,true,i*5);
    assert(c.bias_valid);anka_calibration_bind(&c);
    anka_calibration_step(&c,bias,poses[0],0,true,true,1);
    for(unsigned i=0;i<170;i++){
        float gyro[]={bias[0]+(i&1?8:-8),bias[1],bias[2]};
        float accel[]={i&1?.025f:-.025f,1,0};
        anka_calibration_step(&c,gyro,accel,3,true,true,10+i*5);
    }
    assert(c.phase==CAL_RELEASE&&fabsf(c.bias[0]-bias[0])<.001f);
    // A short contact dropout does not restart the complete hold.
    c=(anka_calibration_t){0};anka_calibration_bind(&c);
    anka_calibration_step(&c,bias,poses[0],0,true,true,1);
    for(unsigned i=0;i<170;i++)anka_calibration_step(&c,bias,poses[0],i>=60&&i<80?1:3,true,true,10+i*5);
    assert(c.phase==CAL_RELEASE);
    // Releasing both early never completes calibration through the grace period.
    c=(anka_calibration_t){0};anka_calibration_bind(&c);
    anka_calibration_step(&c,bias,poses[0],0,true,true,1);
    for(unsigned i=0;i<180;i++)anka_calibration_step(&c,bias,poses[0],i<140?3:0,true,true,10+i*5);
    assert(c.phase==CAL_WAIT);
}
