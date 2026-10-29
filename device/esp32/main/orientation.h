#pragma once
#include <stdbool.h>
#include <stdint.h>
typedef struct { float w,x,y,z; } anka_quat_t;
typedef struct {
    anka_quat_t q,reference,basis;
    float gravity[3];
    uint32_t last,epoch,gaps;
    bool started,calibrated;
} anka_orientation_t;
anka_quat_t anka_quat_multiply(anka_quat_t a,anka_quat_t b);
anka_quat_t anka_quat_inverse(anka_quat_t q);
void anka_quat_rotate(anka_quat_t q,const float in[3],float out[3]);
anka_quat_t anka_orientation_basis(const float acceleration[3]);
void anka_orientation_update(anka_orientation_t *o,const float gyro[3],const float accel[3],uint32_t now);
void anka_orientation_reference(anka_orientation_t *o,const float accel[3]);
anka_quat_t anka_orientation_relative(const anka_orientation_t *o);
