use std::f32::consts::{PI, TAU};

#[derive(Clone, Copy, Debug)]
pub struct GalaxyPoint2 {
    pub x: f32,
    pub z: f32,
}

#[derive(Clone, Copy, Debug)]
pub struct SpiralSystemDistributionOptions {
    pub arm_count: u32,
    pub radius: f32,
    pub winding: f32,
    pub rotation: f32,
    pub seed: u32,

    /// Minimum density between the spiral arms.
    ///
    /// 0.03 means inter-arm space has roughly 3% of the maximum
    /// acceptance probability.
    pub interarm_density: f32,

    /// Angular arm width, in radians, near the galactic center.
    pub arm_width_inner: f32,

    /// Angular arm width, in radians, near the galaxy edge.
    pub arm_width_outer: f32,

    /// Exponent used for radial distribution.
    ///
    /// Values below 1.0 move more systems toward the outside.
    pub radial_bias: f32,

    /// Avoid placing many ordinary systems directly at the center.
    pub min_radius_fraction: f32,

    /// Additional radial noise as a fraction of the galaxy radius.
    pub radial_jitter_fraction: f32,

    /// Minimum allowed distance between generated systems, expressed as a
    /// fraction of the galaxy radius.
    ///
    /// For a galaxy radius of 128, the default value of 0.015 produces a
    /// minimum separation of 1.92 galaxy-local units.
    pub min_distance_fraction: f32,
}

impl Default for SpiralSystemDistributionOptions {
    fn default() -> Self {
        Self {
            arm_count: 4,
            radius: 128.0,
            winding: 1.7,
            rotation: 0.0,
            seed: 1,

            interarm_density: 0.035,
            arm_width_inner: 0.08,
            arm_width_outer: 0.22,
            radial_bias: 0.72,
            min_radius_fraction: 0.06,
            radial_jitter_fraction: 0.012,
            min_distance_fraction: 0.015,
        }
    }
}

fn mix_u32(mut value: u32) -> u32 {
    value ^= value >> 16;
    value = value.wrapping_mul(0x7feb_352d);
    value ^= value >> 15;
    value = value.wrapping_mul(0x846c_a68b);
    value ^ (value >> 16)
}

/// Deterministic random value in [0, 1).
///
/// `salt` identifies the generated system.
/// `channel` identifies one random decision within that system.
fn random_01(seed: u32, salt: u32, channel: u32) -> f32 {
    let value = seed
        ^ salt.wrapping_mul(0x9e37_79b9)
        ^ channel.wrapping_mul(0x85eb_ca6b);

    mix_u32(value) as f32 / 4_294_967_296.0
}

fn gaussian_like(
    seed: u32,
    salt: u32,
    first_channel: u32,
    samples: u32,
) -> f32 {
    let mut total = 0.0;

    for index in 0..samples {
        total += random_01(
            seed,
            salt,
            first_channel.wrapping_add(index),
        );
    }

    total - samples as f32 / 2.0
}

fn lerp(start: f32, end: f32, amount: f32) -> f32 {
    start + (end - start) * amount
}

/// Returns the relative system density at a polar coordinate.
///
/// `progress` is radius / galaxy radius and should be in [0, 1].
/// `angle` is in radians.
pub fn spiral_density_at(
    options: &SpiralSystemDistributionOptions,
    progress: f32,
    angle: f32,
) -> f32 {
    let progress = progress.clamp(0.0, 1.0);
    let arm_count = options.arm_count.max(1) as f32;
    let arm_spacing = TAU / arm_count;

    // This is the center line of arm zero at the requested radius.
    const MIN_ARM_WIDTH: f32 = 0.001;

    let spiral_angle =
        options.rotation + progress * PI * options.winding;

    // Measure the angle relative to the nearest arm.
    let phase = (angle - spiral_angle).rem_euclid(arm_spacing);
    let distance_to_arm = phase.min(arm_spacing - phase);

    let arm_width = lerp(
        options.arm_width_inner,
        options.arm_width_outer,
        progress,
    )
        .max(MIN_ARM_WIDTH);

    // Gaussian falloff away from the arm center.
    let normalized_distance = distance_to_arm / arm_width;
    let arm_visibility =
        (-0.5 * normalized_distance * normalized_distance).exp();

    let interarm = options.interarm_density.clamp(0.0, 1.0);

    interarm + (1.0 - interarm) * arm_visibility
}

pub fn generate_spiral_system_point(
    options: &SpiralSystemDistributionOptions,
    salt: u32,
) -> GalaxyPoint2 {
    let radius = options.radius.max(0.0);

    if radius == 0.0 {
        return GalaxyPoint2 { x: 0.0, z: 0.0 };
    }

    let min_progress =
        options.min_radius_fraction.clamp(0.01, 0.95);

    // Rejection sampling:
    //
    // 1. Pick a candidate anywhere in the disc.
    // 2. Calculate how visible/dense the spiral is there.
    // 3. Accept according to that density.
    for attempt in 0..64_u32 {
        let channel = attempt * 8;

        let radial_random = random_01(
            options.seed,
            salt,
            channel,
        );

        let progress = min_progress
            + (1.0 - min_progress)
            * radial_random.powf(
            options.radial_bias.max(0.05),
        );

        let angle =
            random_01(options.seed, salt, channel + 1) * TAU;

        let density =
            spiral_density_at(options, progress, angle);

        let acceptance =
            random_01(options.seed, salt, channel + 2);

        if acceptance > density {
            continue;
        }

        let radial_jitter = gaussian_like(
            options.seed,
            salt,
            channel + 3,
            4,
        ) * options.radial_jitter_fraction
            * radius
            * (0.35 + progress * 0.65);

        let final_radius =
            (progress * radius + radial_jitter)
                .clamp(0.0, radius);

        return GalaxyPoint2 {
            x: angle.cos() * final_radius,
            z: angle.sin() * final_radius,
        };
    }

    // Extremely unlikely fallback: place the system directly on an arm.
    let progress = min_progress
        + (1.0 - min_progress)
        * random_01(options.seed, salt, 1000)
        .powf(options.radial_bias.max(0.05));

    let arm_count = options.arm_count.max(1);
    let arm_spacing = TAU / arm_count as f32;

    let arm_index = (
        random_01(options.seed, salt, 1001)
            * arm_count as f32
    )
        .floor() as u32;

    let arm_width = lerp(
        options.arm_width_inner,
        options.arm_width_outer,
        progress,
    );

    let angle_jitter = gaussian_like(
        options.seed,
        salt,
        1002,
        4,
    ) * arm_width;

    let angle = options.rotation
        + arm_index as f32 * arm_spacing
        + progress * PI * options.winding
        + angle_jitter;

    let final_radius = progress * radius;

    GalaxyPoint2 {
        x: angle.cos() * final_radius,
        z: angle.sin() * final_radius,
    }
}

pub fn generate_spiral_system_points(
    options: &SpiralSystemDistributionOptions,
    count: usize,
) -> Vec<GalaxyPoint2> {
    if count == 0 {
        return Vec::new();
    }

    let minimum_distance = options.radius.max(0.0)
        * options.min_distance_fraction.clamp(0.0, 1.0);

    if minimum_distance <= f32::EPSILON {
        return (0..count)
            .map(|index| {
                generate_spiral_system_point(
                    options,
                    index as u32,
                )
            })
            .collect();
    }

    let minimum_distance_squared = minimum_distance * minimum_distance;
    let mut points: Vec<GalaxyPoint2> = Vec::with_capacity(count);

    // Candidate salts form one deterministic stream. A rejected candidate is
    // simply skipped, so the result stays reproducible without relying on an
    // ambient RNG inside the WASM module.
    const MAX_CANDIDATES_PER_SYSTEM: usize = 512;
    let maximum_candidates = count.saturating_mul(MAX_CANDIDATES_PER_SYSTEM);

    for candidate_index in 0..maximum_candidates {
        if points.len() == count {
            break;
        }

        let candidate = generate_spiral_system_point(
            options,
            candidate_index as u32,
        );

        let separated = points.iter().all(|existing| {
            let delta_x = candidate.x - existing.x;
            let delta_z = candidate.z - existing.z;

            delta_x * delta_x + delta_z * delta_z
                >= minimum_distance_squared
        });

        if separated {
            points.push(candidate);
        }
    }

    assert_eq!(
        points.len(),
        count,
        "Could only place {} of {} systems with a minimum distance of {:.3}. Lower min_distance_fraction or reduce the requested system count.",
        points.len(),
        count,
        minimum_distance,
    );

    points
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn generated_systems_respect_minimum_distance() {
        let options = SpiralSystemDistributionOptions {
            radius: 128.0,
            seed: 68_421,
            ..SpiralSystemDistributionOptions::default()
        };

        let points = generate_spiral_system_points(&options, 1_500);
        let minimum_distance =
            options.radius * options.min_distance_fraction;
        let minimum_distance_squared =
            minimum_distance * minimum_distance;

        for first in 0..points.len() {
            for second in first + 1..points.len() {
                let delta_x = points[first].x - points[second].x;
                let delta_z = points[first].z - points[second].z;
                let distance_squared =
                    delta_x * delta_x + delta_z * delta_z;

                assert!(
                    distance_squared >= minimum_distance_squared,
                    "systems {first} and {second} are too close",
                );
            }
        }
    }
}