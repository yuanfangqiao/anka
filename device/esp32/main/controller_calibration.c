#include "controller_calibration.h"
#include "freertos/FreeRTOS.h"
#include "freertos/portmacro.h"
static portMUX_TYPE lock=portMUX_INITIALIZER_UNLOCKED;
static controller_calibration_status_t state;
static unsigned hardware_touch,virtual_touch;
static anka_orientation_t orientation;
controller_calibration_status_t controller_calibration_status(void) {
    portENTER_CRITICAL(&lock);controller_calibration_status_t s=state;portEXIT_CRITICAL(&lock);return s;
}
void controller_calibration_bound(void) {
    portENTER_CRITICAL(&lock);anka_calibration_bind(&state.pose);portEXIT_CRITICAL(&lock);
}
bool controller_session_locked(void){return controller_calibration_status().pose.bound;}
bool controller_calibration_ready(void){return controller_calibration_status().pose.phase==CAL_READY;}
void controller_calibration_touch(unsigned mask) {
    portENTER_CRITICAL(&lock);hardware_touch=mask&3;state.screen=hardware_touch|virtual_touch;portEXIT_CRITICAL(&lock);
}
void controller_calibration_virtual_button(unsigned button,bool pressed) {
    portENTER_CRITICAL(&lock);
    if(pressed)virtual_touch|=button&3;else virtual_touch&=~(button&3);
    state.screen=hardware_touch|virtual_touch;portEXIT_CRITICAL(&lock);
}
void controller_calibration_module(bool online,int error,unsigned mask) {
    portENTER_CRITICAL(&lock);
    for(unsigned i=0;i<2;i++)if((mask&(1U<<i))&&!(state.physical&(1U<<i)))state.presses[i]++;
    state.physical=mask&3;state.module_online=online;state.module_error=error;
    portEXIT_CRITICAL(&lock);
}
bool controller_calibration_sample(const float gyro[3],const float accel[3],bool available,
                                   bool connected,uint32_t now,anka_quat_t *pose,uint32_t *id) {
    portENTER_CRITICAL(&lock);state.imu_available=available;
    // Each complete chord must come from one input source, never two unrelated fingers/keys.
    unsigned chord=state.physical==3||hardware_touch==3||virtual_touch==3?3:
                   (state.physical|hardware_touch|virtual_touch)?1:0;
    anka_cal_phase_t before=state.pose.phase;
    anka_calibration_step(&state.pose,gyro,accel,chord,connected,available,now);
    if(available){
        float corrected[3];for(int i=0;i<3;i++)corrected[i]=gyro[i]-state.pose.bias[i];
        anka_orientation_update(&orientation,corrected,accel,now);
        if(before!=CAL_READY&&state.pose.phase==CAL_READY)anka_orientation_reference(&orientation,accel);
    }
    *pose=anka_orientation_relative(&orientation);*id=orientation.epoch;
    state.orientation=*pose;state.orientation_id=*id;state.imu_gaps=orientation.gaps;
    bool ready=state.pose.phase==CAL_READY&&orientation.calibrated;
    portEXIT_CRITICAL(&lock);return ready&&available;
}
