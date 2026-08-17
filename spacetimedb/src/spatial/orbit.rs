use crate::tables::data_tables::{Moon, Planet, Vec3f};

#[derive(Clone, Copy, Debug)]
pub struct OrbitDefinition {
    /// Semi-major axis in the parent node's local units.
    pub semi_major_axis: f64,
    pub eccentricity: f64,
    /// All orbital angles are radians.
    pub inclination: f64,
    pub longitude_of_ascending_node: f64,
    pub argument_of_periapsis: f64,
    /// Eccentric-anomaly-like path parameter at simulation t=0.
    pub phase_at_epoch: f64,
    /// Radians per simulation second.
    pub angular_speed: f64,
}

const TAU: f64 = std::f64::consts::TAU;


pub fn planet_orbit_definition(planet: &Planet) -> OrbitDefinition {
    OrbitDefinition {
        semi_major_axis: f64::from(planet.orbit_radius),
        eccentricity: f64::from(planet.orbit_eccentricity),
        inclination: f64::from(planet.orbit_inclination),
        longitude_of_ascending_node: f64::from(planet.orbit_longitude),
        argument_of_periapsis: f64::from(planet.orbit_argument),
        phase_at_epoch: f64::from(planet.orbit_offset),
        angular_speed: f64::from(planet.orbit_speed),
    }
}

pub fn moon_orbit_definition(moon: &Moon) -> OrbitDefinition {
    OrbitDefinition {
        semi_major_axis: f64::from(moon.orbit_radius),
        eccentricity: f64::from(moon.orbit_eccentricity),
        inclination: f64::from(moon.orbit_inclination),
        longitude_of_ascending_node: f64::from(moon.orbit_longitude),
        argument_of_periapsis: f64::from(moon.orbit_argument),
        phase_at_epoch: f64::from(moon.orbit_offset),
        angular_speed: f64::from(moon.orbit_speed),
    }
}

pub fn normalize_radians(value: f64) -> f64 {
    value.rem_euclid(TAU)
}

pub fn orbit_phase_at_time(orbit: OrbitDefinition, simulation_time_seconds: f64) -> f64 {
    normalize_radians(orbit.phase_at_epoch + orbit.angular_speed * simulation_time_seconds)
}

/// Parent-local orbit evaluation. Keep this operation order identical to
/// `src/spatial/orbit.ts` so reducers and renderers agree exactly.
pub fn orbit_position_at_phase(orbit: OrbitDefinition, phase: f64) -> Vec3f {
    let eccentricity = orbit.eccentricity.clamp(0.0, 0.95);
    let semi_major_axis = orbit.semi_major_axis.max(0.0);
    let semi_minor_axis = semi_major_axis * (1.0 - eccentricity * eccentricity).sqrt();

    let x = semi_major_axis * (phase.cos() - eccentricity);
    let z = semi_minor_axis * phase.sin();

    let cos_argument = orbit.argument_of_periapsis.cos();
    let sin_argument = orbit.argument_of_periapsis.sin();
    let argument_x = cos_argument * x + sin_argument * z;
    let argument_z = -sin_argument * x + cos_argument * z;

    let cos_inclination = orbit.inclination.cos();
    let sin_inclination = orbit.inclination.sin();
    let tilted_x = argument_x;
    let tilted_y = -sin_inclination * argument_z;
    let tilted_z = cos_inclination * argument_z;

    let cos_longitude = orbit.longitude_of_ascending_node.cos();
    let sin_longitude = orbit.longitude_of_ascending_node.sin();

    Vec3f {
        x: (cos_longitude * tilted_x + sin_longitude * tilted_z) as f32,
        y: tilted_y as f32,
        z: (-sin_longitude * tilted_x + cos_longitude * tilted_z) as f32,
    }
}

pub fn orbit_position_at_time(orbit: OrbitDefinition, simulation_time_seconds: f64) -> Vec3f {
    orbit_position_at_phase(orbit, orbit_phase_at_time(orbit, simulation_time_seconds))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn assert_close(actual: f32, expected: f32) {
        assert!((actual - expected).abs() < 0.000_1, "{actual} != {expected}");
    }

    #[test]
    fn circular_unrotated_orbit_starts_on_positive_x() {
        let orbit = OrbitDefinition {
            semi_major_axis: 10.0,
            eccentricity: 0.0,
            inclination: 0.0,
            longitude_of_ascending_node: 0.0,
            argument_of_periapsis: 0.0,
            phase_at_epoch: 0.0,
            angular_speed: 1.0,
        };

        let position = orbit_position_at_time(orbit, 0.0);
        assert_close(position.x, 10.0);
        assert_close(position.y, 0.0);
        assert_close(position.z, 0.0);
    }

    #[test]
    fn inclination_produces_vertical_motion() {
        let orbit = OrbitDefinition {
            semi_major_axis: 10.0,
            eccentricity: 0.2,
            inclination: 0.3,
            longitude_of_ascending_node: 0.7,
            argument_of_periapsis: 0.4,
            phase_at_epoch: std::f64::consts::FRAC_PI_2,
            angular_speed: 0.0,
        };

        let position = orbit_position_at_time(orbit, 0.0);
        assert!(position.y.abs() > 0.1);
    }
}
