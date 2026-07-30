use std::f32::consts::PI;

#[derive(Clone, Debug)]
pub struct GalaxyPoints {
    pub x: f32,
    pub y: f32,
}

#[derive(Clone, Debug)]
pub struct GalaxyPointDistributionOptions {
    pub arm_count: u32,
    pub radius: f32,
    pub winding: f32,
    pub seed: u32
}

struct SeededRandom {
    seed: u32,
}

impl SeededRandom {
    fn new(seed: u32) -> Self {
        Self { seed }
    }

    fn next_f32(&mut self) -> f32 {
        self.state = self.state.wrapping_add(0x6d2b79f5);

        let mut value = self.state;
        value = (value ^ (value >> 15)).wrapping_mul(value | 1);
        value ^= value.wrapping_add((value ^ (value >> 7)).wrapping_mul(value | 61));

        ((value ^ (value >> 14)) as f32) / (u32::MAX as f32 + 1.0)
    }

    fn gaussian_like(&mut self, samples: usize) -> f32 {
        let mut total = 0.0;

        for _ in 0..samples {
            total += self.next_f32();
        }

        total - samples as f32 / 2.0
    }
}

pub fn generate_spiral_point_2d(options: &GalaxyPointDistributionOptions, salt: u32) -> SpiralPoint2 {
    let arm_count = options.arm_count.max(1);
    let radius = options.radius.max(0.0);
    let winding = options.winding;

    let mut random = SeededRandom::new(options.seed ^ salt.wrapping_mul(0x9e3779b9));

    // Bias outward slightly so the galaxy does not overfill the center.
    let progress = random.next_f32().powf(0.66);

    let base_radius = progress * radius;

    let arm_index = (random.next_f32() * arm_count as f32).floor() as u16;
    let arm_angle = arm_index as f32 * ((PI * 2.0) / arm_count as f32);

    let spiral_angle = arm_angle + progress * PI * winding;

    let angle_jitter = random.gaussian_like(4) * (0.1 + progress * 0.26) * arm_tightness;
    let radius_jitter = random.gaussian_like(4) * radius * (0.008 + progress * 0.026) * arm_tightness;

    let final_radius = (base_radius + radius_jitter).clamp(0.0, radius);
    let final_angle = spiral_angle + angle_jitter + options.rotation;

    GalaxyPoints {
        x: final_angle.cos() * final_radius,
        y: final_angle.sin() * final_radius,
    }
}
