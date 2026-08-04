use spacetimedb::rand::Rng;
use spacetimedb::ReducerContext;
use crate::procedural::galaxy_points::{
    generate_spiral_system_points, SpiralSystemDistributionOptions,
};
use crate::tables::data_tables::{AccretionDisk, BlackHole, Galaxy, Moon, Planet, PlanetTemperature, StarSystem, SystemMapRole, SystemPrimaryKind, Vec3f};
use crate::types::Vec3;


const PRIMARY_DISTRIBUTION_MAX: u32 = 10_000;
const BLACK_HOLE_CUTOFF: u32 = 50; // 0.5% of generated systems.


pub fn generate_galaxies() -> Vec<Galaxy> {
    let original_galaxy = Galaxy {
        id: "perseus-ledger".to_string(),
        name: "The Perseus Ledger".to_string(),
        position: Vec3 {
            x: 0.0,
            y: 0.0,
            z: 0.0,
        },
        radius: 128.0,
        thickness: 10.0,
        rotation: -0.18,
        inclination: None,
        morphology: "spiral".to_string(),
        primary_color: "#7f9cff".to_string(),
        secondary_color: "#ffd2a1".to_string(),
        description: "the home galaxy and the origin of all".to_string(),
        discovered_by: "Native astronomy".to_string(),
        estimated_systems: "180-200 billion".to_string(),
        seed: 68_421.0,
        arm_count: Some(4),
        arm_winding: Some(1.7),
        companions: None,
        home: Some(true),
    };

    let second_galaxy = Galaxy {
        id: "perseus-destroyer".to_string(),
        name: "The Perseus Destroyer".to_string(),
        position: Vec3 {
            x: 600.0,
            y: 10.0,
            z: 200.0,
        },
        radius: 368.0,
        thickness: 40.0,
        rotation: -0.68,
        inclination: None,
        morphology: "spiral".to_string(),
        primary_color: "#2f9cff".to_string(),
        secondary_color: "#ffe211".to_string(),
        description: "the home galaxy and the origin of all".to_string(),
        discovered_by: "Native astronomy".to_string(),
        estimated_systems: "180-200 billion".to_string(),
        seed: 12.0,
        arm_count: Some(4),
        arm_winding: Some(1.7),
        companions: None,
        home: Some(false),
    };

    vec![original_galaxy, second_galaxy]
}

pub(crate) fn generate_star_systems(
    galaxies: Vec<Galaxy>,
    wanted_amount_of_systems: Vec<usize>,
    context: &ReducerContext
) -> (Vec<StarSystem>, Vec<Planet>, Vec<Moon>) {
    let mut star_systems = Vec::new();
    let mut planets = Vec::new();
    let mut moons = Vec::new();
    let mut rng = context.rng();
    for (galaxy_index, galaxy) in galaxies.iter().enumerate() {
        let amount_of_systems = wanted_amount_of_systems
            .get(galaxy_index)
            .copied()
            .unwrap_or(1_000);

        // The backend stores positions in galaxy-local coordinates:
        // - (0, 0, 0) is the center of this galaxy.
        // - x/z are bounded by galaxy.radius.
        // - rotation is deliberately zero here. The overview's galaxy.rotation
        //   is a presentation transform and is not part of opened-galaxy local
        //   coordinates.
        //
        // These defaults match the center lines used by the frontend spiral
        // renderer in buildGalaxyPointGeometry.
        let distribution = SpiralSystemDistributionOptions {
            arm_count: galaxy.arm_count.unwrap_or(4) as u32,
            radius: galaxy.radius,
            winding: galaxy.arm_winding.unwrap_or(1.7),
            rotation: 0.0,
            seed: rng.gen_range(0..=u32::MAX),
            // Keep markers visually separated after the frontend scales the
            // galaxy-local coordinates into the opened galaxy view.
            min_distance_fraction: 0.015,
            ..SpiralSystemDistributionOptions::default()
        };

        let points = generate_spiral_system_points(&distribution, amount_of_systems);

        // TODO: add sophisticated logic for names, primary stars and planets.
        for (system_index, point) in points.into_iter().enumerate() {
            let id = format!("{}-system-{}", galaxy.id, system_index);
            let name = format!("{} System {}", galaxy.name, system_index + 1);
            let generated_primary = generate_primary(&mut rng);

            let black_hole = if generated_primary.is_black_hole {
                Some(generate_black_hole(&mut rng, &generated_primary))
            } else {
                None
            };

            // `star_radius` and the accretion-disk dimensions are display-space
            // values. Orbit spacing must clear the complete rendered primary,
            // not merely its physical/event-horizon radius.
            let primary_visual_extent = black_hole
                .as_ref()
                .and_then(|value| value.accretion_disk.as_ref())
                .map(|disk| disk.outer_radius)
                .unwrap_or(generated_primary.radius)
                .max(generated_primary.radius)
                * 1.15;

            let system_description = if generated_primary.is_black_hole {
                "An unclaimed system centered on a stellar-mass black hole.".to_string()
            } else {
                format!(
                    "An unclaimed system centered on a {}.",
                    generated_primary.spectral_type
                )
            };

            star_systems.push(StarSystem {
                id: id.clone(),
                galaxy_id: galaxy.id.clone(),
                name: name.clone(),
                position: Vec3f {
                    x: point.x,
                    y: 0.0,
                    z: point.z,
                },
                primary_kind: if generated_primary.is_black_hole {
                    SystemPrimaryKind::BlackHole
                } else {
                    SystemPrimaryKind::Star
                },
                map_role: SystemMapRole::Standard,
                spectral_type: generated_primary.spectral_type.to_string(),
                star_color: generated_primary.color.to_string(),
                star_radius: generated_primary.radius,
                black_hole,
                zone_color: None,
                zone_radius: None,
                zone_strength: None,
                zone_name: None,
                owner_identity: None,
                description: system_description,
                faction: "Unclaimed".to_string(),
                population: 0,
            });

            const DISTR_MAX_VALUE: u32 = 10_000;
            const DISTR_0_PLANETS_CUTOFF: u32 = 100;

            const DISTR_1_PLANET_CUTOFF: u32 = 1_000;
            const DISTR_2_PLANETS_CUTOFF: u32 = 2_000;
            const DISTR_3_PLANETS_CUTOFF: u32 = 4_000;
            const DISTR_4_PLANETS_CUTOFF: u32 = 6_000;
            const DISTR_5_PLANETS_CUTOFF: u32 = 8_000;
            const DISTR_6_PLANETS_CUTOFF: u32 = 8_500;
            const DISTR_7_PLANETS_CUTOFF: u32 = 8_800;
            const DISTR_8_PLANETS_CUTOFF: u32 = 9_000;
            const DISTR_9_PLANETS_CUTOFF: u32 = 9_500;
            const DISTR_10_PLANETS_CUTOFF: u32 = 9_700;
            const DISTR_11_PLANETS_CUTOFF: u32 = 9_800;
            const DISTR_12_PLANETS_CUTOFF: u32 = 9_900;
            const DISTR_13_PLANETS_CUTOFF: u32 = 9_950;
            const DISTR_14_PLANETS_CUTOFF: u32 = 9_970;
            const DISTR_15_PLANETS_CUTOFF: u32 = 9_980;
            const DISTR_16_PLANETS_CUTOFF: u32 = 9_991;

            let distr_value = rng.gen_range(0..DISTR_MAX_VALUE);
            let number_of_planets = match distr_value {
                0..DISTR_0_PLANETS_CUTOFF => 0,
                DISTR_0_PLANETS_CUTOFF..DISTR_1_PLANET_CUTOFF => 1,
                DISTR_1_PLANET_CUTOFF..DISTR_2_PLANETS_CUTOFF => 2,
                DISTR_2_PLANETS_CUTOFF..DISTR_3_PLANETS_CUTOFF => 3,
                DISTR_3_PLANETS_CUTOFF..DISTR_4_PLANETS_CUTOFF => 4,
                DISTR_4_PLANETS_CUTOFF..DISTR_5_PLANETS_CUTOFF => 5,
                DISTR_5_PLANETS_CUTOFF..DISTR_6_PLANETS_CUTOFF => 6,
                DISTR_6_PLANETS_CUTOFF..DISTR_7_PLANETS_CUTOFF => 7,
                DISTR_7_PLANETS_CUTOFF..DISTR_8_PLANETS_CUTOFF => 8,
                DISTR_8_PLANETS_CUTOFF..DISTR_9_PLANETS_CUTOFF => 9,
                DISTR_9_PLANETS_CUTOFF..DISTR_10_PLANETS_CUTOFF => 10,
                DISTR_10_PLANETS_CUTOFF..DISTR_11_PLANETS_CUTOFF => 11,
                DISTR_11_PLANETS_CUTOFF..DISTR_12_PLANETS_CUTOFF => 12,
                DISTR_12_PLANETS_CUTOFF..DISTR_13_PLANETS_CUTOFF => 13,
                DISTR_13_PLANETS_CUTOFF..DISTR_14_PLANETS_CUTOFF => 14,
                DISTR_14_PLANETS_CUTOFF..DISTR_15_PLANETS_CUTOFF => 15,
                DISTR_15_PLANETS_CUTOFF..DISTR_16_PLANETS_CUTOFF => 16,
                _ => 17,
            };

            let mut orbit_seed = initial_planet_orbit_radius(
                &mut rng,
                generated_primary.heating_mass,
                generated_primary.is_black_hole,
            );
            let mut previous_orbit_radius: Option<f32> = None;
            let mut previous_visual_extent = 0.0f32;

            for planet_index in 0..number_of_planets {
                if planet_index > 0 {
                    orbit_seed = advance_planet_orbit_radius(
                        &mut rng,
                        orbit_seed,
                        number_of_planets,
                        generated_primary.is_black_hole,
                    );
                }

                let mut orbit_radius = orbit_seed;
                let mut thermal_zone = estimate_thermal_zone(
                    generated_primary.heating_mass,
                    orbit_radius,
                    generated_primary.is_black_hole,
                );
                let mut planet_kind =
                    generate_planet_kind(&mut rng, thermal_zone);
                let mut appearance =
                    generate_planet_appearance(&mut rng, planet_kind);

                // Re-evaluate the planet after moving it outward. This keeps the
                // visual bodies from touching while allowing a moved planet to
                // become hot/cold/frozen according to its final orbit.
                for _ in 0..3 {
                    let visual_extent = planet_visual_extent(&appearance);
                    let minimum_orbit = minimum_clear_orbit_radius(
                        primary_visual_extent,
                        previous_orbit_radius,
                        previous_visual_extent,
                        visual_extent,
                    );

                    if orbit_radius >= minimum_orbit {
                        break;
                    }

                    orbit_radius = minimum_orbit;
                    thermal_zone = estimate_thermal_zone(
                        generated_primary.heating_mass,
                        orbit_radius,
                        generated_primary.is_black_hole,
                    );
                    planet_kind =
                        generate_planet_kind(&mut rng, thermal_zone);
                    appearance =
                        generate_planet_appearance(&mut rng, planet_kind);
                }

                // The final generated appearance may be larger than the prior
                // provisional one, especially when rings are present.
                let mut visual_extent = planet_visual_extent(&appearance);
                orbit_radius = orbit_radius.max(minimum_clear_orbit_radius(
                    primary_visual_extent,
                    previous_orbit_radius,
                    previous_visual_extent,
                    visual_extent,
                ));

                // Recompute from the final display orbit so close worlds are
                // scorched/hot and distant worlds become cold or frozen.
                let final_thermal_zone = estimate_thermal_zone(
                    generated_primary.heating_mass,
                    orbit_radius,
                    generated_primary.is_black_hole,
                );
                if final_thermal_zone != thermal_zone {
                    planet_kind =
                        generate_planet_kind(&mut rng, final_thermal_zone);
                    appearance =
                        generate_planet_appearance(&mut rng, planet_kind);
                    visual_extent = planet_visual_extent(&appearance);
                    orbit_radius = orbit_radius.max(minimum_clear_orbit_radius(
                        primary_visual_extent,
                        previous_orbit_radius,
                        previous_visual_extent,
                        visual_extent,
                    ));
                }

                orbit_seed = orbit_radius;
                previous_orbit_radius = Some(orbit_radius);
                previous_visual_extent = visual_extent;

                let primary_mass = generated_primary.mass as f32;
                let orbit_speed = (
                    2.4 * primary_mass.sqrt() / orbit_radius.powf(1.5)
                )
                    .clamp(0.002, 0.30);
                let orbit_offset =
                    rng.gen_range(0.0f32..std::f32::consts::TAU);

                let temperature = generate_planet_temperature(
                    generated_primary.heating_mass,
                    generated_primary.is_black_hole,
                    orbit_radius,
                    planet_kind,
                    &mut rng,
                );

                let planet_id = format!("{}-planet-{}", id, planet_index);

                let tidally_locked = is_tidally_locked(
                    planet_kind,
                    orbit_radius,
                    generated_primary.mass,
                    &mut rng,
                );

                let axial_tilt = if tidally_locked {
                    rng.gen_range(0.0f32..3.0f32)
                } else {
                    rng.gen_range(0.0f32..38.0f32)
                };

                let land_fraction =
                    generate_land_fraction(planet_kind, &mut rng);

                let ring_color = if appearance.has_rings {
                    Some(generate_ring_color(planet_kind).to_string())
                } else {
                    None
                };

                let planet_resources =
                    generate_planet_resources(planet_kind);

                let planet_description = generate_planet_description(
                    planet_kind,
                    tidally_locked,
                    temperature.equator,
                );

                let planet_type =
                    generate_planet_type_name(planet_kind, temperature.equator);

                planets.push(Planet {
                    id: planet_id.clone(),
                    system_id: id.clone(),
                    name: planet_id.clone(),
                    planet_type: planet_type.to_string(),
                    radius: appearance.radius,
                    orbit_radius,
                    orbit_speed,
                    orbit_offset,
                    orbit_index: planet_index as u16,
                    color: appearance.color.to_string(),
                    secondary_color: appearance
                        .secondary_color
                        .map(str::to_string),
                    temperature,
                    population: 0,
                    colonized: false,
                    production: None,
                    gravity: appearance.gravity,
                    atmosphere: appearance.atmosphere.to_string(),
                    description: planet_description.to_string(),
                    discovered_by: "Automated deep-space survey".to_string(),
                    resources: planet_resources
                        .into_iter()
                        .map(str::to_string)
                        .collect(),
                    axial_tilt,
                    tidally_locked,
                    land_fraction,
                    ring_color,
                });

                let number_of_moons =
                    generate_moon_count(&mut rng, planet_kind);

                let mut next_moon_orbit =
                    appearance.radius * rng.gen_range(1.65f32..2.10f32);

                for moon_index in 0..number_of_moons {
                    if moon_index > 0 {
                        next_moon_orbit *= rng.gen_range(1.16f32..1.34f32);
                    }

                    let moon_appearance =
                        generate_moon_appearance(&mut rng, planet_kind);

                    let moon_id =
                        format!("{}-moon-{}", planet_id, moon_index);

                    let moon_name =
                        format!("{}-{}", planet_index + 1, moon_index + 1);

                    let moon_orbit_radius = next_moon_orbit;

                    let moon_orbit_speed =
                        (0.90 / moon_orbit_radius.sqrt()).clamp(0.06, 0.90);

                    let moon_orbit_offset =
                        rng.gen_range(0.0f32..std::f32::consts::TAU);

                    moons.push(Moon {
                        id: moon_id,
                        planet_id: planet_id.clone(),
                        name: moon_name,
                        moon_type: moon_appearance.type_name.to_string(),
                        radius: moon_appearance.radius,
                        orbit_radius: moon_orbit_radius,
                        orbit_speed: moon_orbit_speed,
                        orbit_offset: moon_orbit_offset,
                        color: moon_appearance.color.to_string(),
                        secondary_color: moon_appearance
                            .secondary_color
                            .map(str::to_string),
                    });
                }
            }
        }
    }

    (star_systems, planets, moons)
}



#[derive(Clone, Copy)]
struct GeneratedPrimary {
    is_black_hole: bool,
    mass: f64,
    heating_mass: f64,
    spectral_type: &'static str,
    color: &'static str,
    radius: f32,
}

fn generate_primary<R: Rng>(rng: &mut R) -> GeneratedPrimary {
    let primary_roll = rng.gen_range(0..PRIMARY_DISTRIBUTION_MAX);

    if primary_roll < BLACK_HOLE_CUTOFF {
        return generate_black_hole_primary(rng);
    }

    generate_star(rng)
}

fn generate_black_hole_primary<R: Rng>(rng: &mut R) -> GeneratedPrimary {
    let mass_roll = rng.gen_range(0..100);
    let mass = match mass_roll {
        0..25 => rng.gen_range(4.0f64..8.0f64),
        25..75 => rng.gen_range(8.0f64..15.0f64),
        75..95 => rng.gen_range(15.0f64..30.0f64),
        _ => rng.gen_range(30.0f64..50.0f64),
    };

    let radius = (0.85 + (mass / 4.0).log10() * 0.45)
        .clamp(0.85, 1.45) as f32;

    GeneratedPrimary {
        is_black_hole: true,
        mass,
        heating_mass: 0.0,
        spectral_type: "Stellar-mass black hole",
        color: "#ffb36b",
        radius,
    }
}

fn generate_black_hole<R: Rng>(
    rng: &mut R,
    primary: &GeneratedPrimary,
) -> BlackHole {
    let accretion_disk = if rng.gen_bool(0.77) {
        Some(AccretionDisk {
            inner_radius: primary.radius * rng.gen_range(1.35f32..1.60f32),
            outer_radius: primary.radius * rng.gen_range(4.0f32..8.0f32),
            thickness: rng.gen_range(0.08f32..0.35f32),
            tilt: Vec3f {
                x: rng.gen_range(-0.25f32..0.25f32),
                y: rng.gen_range(-0.25f32..0.25f32),
                z: rng.gen_range(-0.50f32..0.50f32),
            },
            inner_color: "#fff7d6".to_string(),
            outer_color: "#e94b2f".to_string(),
            opacity: rng.gen_range(0.55f32..0.95f32),
            luminosity: rng.gen_range(0.30f32..1.60f32),
            rotation_speed: rng.gen_range(0.8f32..3.5f32),
        })
    } else {
        None
    };

    BlackHole {
        mass_solar: primary.mass.round() as u64,
        event_horizon_radius: primary.radius,
        spin: rng.gen_range(0.05f32..0.98f32),
        photon_ring_color: "#fff3cf".to_string(),
        accretion_disk,
        jet_color: "#74e7ff".to_string(),
        jet_length: 0.0,
        jet_intensity: 0.0,
        lensing_strength: rng.gen_range(0.75f32..1.20f32),
        lensing_radius_multiplier: rng.gen_range(1.35f32..1.90f32),
    }
}

fn generate_star<R: Rng>(rng: &mut R) -> GeneratedPrimary {
    let roll = rng.gen_range(0..10_000);

    let (mass_min, mass_max, spectral_type, color) = match roll {
        // Game-friendly distribution:
        // 25% red dwarfs
        0..2_500 => (0.10, 0.45, "M-class red dwarf", "#ff665c"),

        // 22% orange dwarfs
        2_500..4_700 => (0.45, 0.80, "K-class orange dwarf", "#ff9e59"),

        // 28% Sun-like stars
        4_700..7_500 => (0.80, 1.10, "G-class yellow dwarf", "#ffd98a"),

        // 15% yellow-white stars
        7_500..9_000 => (1.10, 1.40, "F-class yellow-white dwarf", "#fff0c4"),

        // 7% white stars
        9_000..9_700 => (1.40, 2.10, "A-class white main-sequence star", "#dbe8ff"),

        // 2.7% blue-white stars
        9_700..9_970 => (2.10, 16.0, "B-class blue-white main-sequence star", "#a9c8ff"),

        // 0.3% massive blue stars
        _ => (16.0, 120.0, "O-class blue main-sequence star", "#8fb6ff"),
    };

    // powi(2) favors the lower end of each spectral class.
    let u = rng.gen_range(0.0f64..=1.0).powi(2);
    let mass = mass_min + (mass_max - mass_min) * u;

    // Useful visual radius, rather than a precise physical stellar radius.
    // The clamp prevents rare massive stars from covering the system view.
    let radius = mass.powf(0.55).clamp(0.35, 4.5) as f32;

    GeneratedPrimary {
        is_black_hole: false,
        mass,
        heating_mass: mass,
        spectral_type,
        color,
        radius,
    }
}

#[derive(Clone, Copy)]
enum GeneratedPlanetKind {
    Barren,
    Volcanic,
    Terrestrial,
    Ocean,
    SuperEarth,
    IceWorld,
    Neptunian,
    GasGiant,
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum ThermalZone {
    Scorched,
    Hot,
    Temperate,
    Cold,
    Frozen,
}

fn temperate_orbit_radius(heating_mass: f64) -> f32 {
    if heating_mass <= 0.0 {
        return 24.0;
    }

    // This is a display-space thermal scale, not AU. A minimum scale keeps
    // low-mass stars visually separated from their inner planets while still
    // permitting a genuinely scorched inner zone.
    (16.0 * heating_mass.powf(0.85))
        .clamp(12.0, 250.0) as f32
}

fn initial_planet_orbit_radius<R: Rng>(
    rng: &mut R,
    heating_mass: f64,
    is_black_hole: bool,
) -> f32 {
    if is_black_hole {
        rng.gen_range(12.0f32..45.0f32)
    } else {
        let temperate_radius = temperate_orbit_radius(heating_mass);
        temperate_radius * rng.gen_range(0.18f32..0.42f32)
    }
}

fn advance_planet_orbit_radius<R: Rng>(
    rng: &mut R,
    current_radius: f32,
    planet_count: usize,
    is_black_hole: bool,
) -> f32 {
    let (minimum_ratio, maximum_ratio) = if is_black_hole {
        if planet_count >= 12 {
            (1.42f32, 1.72f32)
        } else {
            (1.65f32, 2.35f32)
        }
    } else if planet_count >= 12 {
        (1.30f32, 1.55f32)
    } else if planet_count >= 7 {
        (1.42f32, 1.82f32)
    } else {
        (1.60f32, 2.25f32)
    };

    let mut ratio = rng.gen_range(minimum_ratio..maximum_ratio);

    // Create occasional asteroid-belt-like or cleared gaps between groups.
    if rng.gen_bool(0.16) {
        ratio *= rng.gen_range(1.30f32..1.90f32);
    }

    current_radius * ratio
}

fn planet_visual_extent(appearance: &GeneratedPlanetAppearance) -> f32 {
    if appearance.has_rings {
        // The frontend's visible ring geometry extends far beyond the planet's
        // own radius, so reserve enough radial room for the complete ring disc.
        appearance.radius * 3.25
    } else {
        appearance.radius * 1.30
    }
}

fn minimum_clear_orbit_radius(
    primary_visual_extent: f32,
    previous_orbit_radius: Option<f32>,
    previous_visual_extent: f32,
    current_visual_extent: f32,
) -> f32 {
    match previous_orbit_radius {
        None => {
            let safety_margin = 2.25 + primary_visual_extent * 0.35;
            primary_visual_extent + current_visual_extent + safety_margin
        }
        Some(previous_radius) => {
            let safety_margin =
                1.75 + 0.20 * (previous_visual_extent + current_visual_extent);
            previous_radius
                + previous_visual_extent
                + current_visual_extent
                + safety_margin
        }
    }
}

fn estimate_thermal_zone(
    heating_mass: f64,
    orbit_radius: f32,
    is_black_hole: bool,
) -> ThermalZone {
    if is_black_hole || heating_mass <= 0.0 {
        return ThermalZone::Frozen;
    }

    let temperate_radius = temperate_orbit_radius(heating_mass);
    let estimated_temperature = 15.0
        + 210.0 * (temperate_radius / orbit_radius).ln();

    if estimated_temperature >= 250.0 {
        ThermalZone::Scorched
    } else if estimated_temperature >= 80.0 {
        ThermalZone::Hot
    } else if estimated_temperature >= -35.0 {
        ThermalZone::Temperate
    } else if estimated_temperature >= -130.0 {
        ThermalZone::Cold
    } else {
        ThermalZone::Frozen
    }
}

fn generate_planet_kind<R: Rng>(
    rng: &mut R,
    thermal_zone: ThermalZone,
) -> GeneratedPlanetKind {
    let roll = rng.gen_range(0..100);

    match thermal_zone {
        ThermalZone::Scorched => match roll {
            0..45 => GeneratedPlanetKind::Barren,
            45..78 => GeneratedPlanetKind::Volcanic,
            78..92 => GeneratedPlanetKind::SuperEarth,
            92..97 => GeneratedPlanetKind::Neptunian,
            _ => GeneratedPlanetKind::GasGiant,
        },

        ThermalZone::Hot => match roll {
            0..25 => GeneratedPlanetKind::Barren,
            25..45 => GeneratedPlanetKind::Volcanic,
            45..65 => GeneratedPlanetKind::Terrestrial,
            65..82 => GeneratedPlanetKind::SuperEarth,
            82..93 => GeneratedPlanetKind::Neptunian,
            _ => GeneratedPlanetKind::GasGiant,
        },

        ThermalZone::Temperate => match roll {
            0..12 => GeneratedPlanetKind::Barren,
            12..44 => GeneratedPlanetKind::Terrestrial,
            44..64 => GeneratedPlanetKind::Ocean,
            64..82 => GeneratedPlanetKind::SuperEarth,
            82..94 => GeneratedPlanetKind::Neptunian,
            _ => GeneratedPlanetKind::GasGiant,
        },

        ThermalZone::Cold => match roll {
            0..18 => GeneratedPlanetKind::Barren,
            18..45 => GeneratedPlanetKind::IceWorld,
            45..52 => GeneratedPlanetKind::SuperEarth,
            52..78 => GeneratedPlanetKind::Neptunian,
            _ => GeneratedPlanetKind::GasGiant,
        },

        ThermalZone::Frozen => match roll {
            0..20 => GeneratedPlanetKind::Barren,
            20..52 => GeneratedPlanetKind::IceWorld,
            52..58 => GeneratedPlanetKind::SuperEarth,
            58..82 => GeneratedPlanetKind::Neptunian,
            _ => GeneratedPlanetKind::GasGiant,
        },
    }
}


struct GeneratedPlanetAppearance {
    type_name: &'static str,
    radius: f32,
    gravity: f32,
    color: &'static str,
    secondary_color: Option<&'static str>,
    atmosphere: &'static str,
    has_rings: bool,
}

fn generate_planet_appearance<R: Rng>(
    rng: &mut R,
    kind: GeneratedPlanetKind,
) -> GeneratedPlanetAppearance {
    match kind {
        GeneratedPlanetKind::Barren => GeneratedPlanetAppearance {
            type_name: "Barren rocky world",
            radius: rng.gen_range(0.42..0.76),
            gravity: rng.gen_range(0.25..0.85),
            color: "#756b62",
            secondary_color: Some("#a39486"),
            atmosphere: "Trace gases",
            has_rings: false,
        },

        GeneratedPlanetKind::Volcanic => GeneratedPlanetAppearance {
            type_name: "Volcanic rocky world",
            radius: rng.gen_range(0.55..0.92),
            gravity: rng.gen_range(0.55..1.45),
            color: "#6f3028",
            secondary_color: Some("#e46e38"),
            atmosphere: "Carbon dioxide / sulfur dioxide",
            has_rings: false,
        },

        GeneratedPlanetKind::Terrestrial => GeneratedPlanetAppearance {
            type_name: "Temperate terrestrial world",
            radius: rng.gen_range(0.62..0.90),
            gravity: rng.gen_range(0.65..1.25),
            color: "#3f7fc4",
            secondary_color: Some("#60905d"),
            atmosphere: "Nitrogen / oxygen / argon",
            has_rings: false,
        },

        GeneratedPlanetKind::Ocean => GeneratedPlanetAppearance {
            type_name: "Ocean world",
            radius: rng.gen_range(0.68..0.96),
            gravity: rng.gen_range(0.75..1.30),
            color: "#247aa2",
            secondary_color: Some("#58d2c2"),
            atmosphere: "Nitrogen / water vapor",
            has_rings: false,
        },

        GeneratedPlanetKind::SuperEarth => GeneratedPlanetAppearance {
            type_name: "Rocky super-Earth",
            radius: rng.gen_range(0.82..1.06),
            gravity: rng.gen_range(1.15..1.90),
            color: "#826c58",
            secondary_color: Some("#c59a6f"),
            atmosphere: "Dense nitrogen / carbon dioxide",
            has_rings: false,
        },

        GeneratedPlanetKind::IceWorld => GeneratedPlanetAppearance {
            type_name: "Frozen terrestrial world",
            radius: rng.gen_range(0.52..0.86),
            gravity: rng.gen_range(0.45..1.05),
            color: "#7695a5",
            secondary_color: Some("#d3e5ea"),
            atmosphere: "Thin nitrogen / methane",
            has_rings: false,
        },

        GeneratedPlanetKind::Neptunian => GeneratedPlanetAppearance {
            type_name: "Ice giant",
            radius: rng.gen_range(0.92..1.12),
            gravity: rng.gen_range(0.85..1.35),
            color: "#5f9da6",
            secondary_color: Some("#b2e4dc"),
            atmosphere: "Hydrogen / helium / methane",
            has_rings: rng.gen_bool(0.30),
        },

        GeneratedPlanetKind::GasGiant => GeneratedPlanetAppearance {
            type_name: "Gas giant",
            radius: rng.gen_range(1.05..1.35),
            gravity: rng.gen_range(0.90..1.65),
            color: "#b77f56",
            secondary_color: Some("#f2cf99"),
            atmosphere: "Hydrogen / helium / ammonia",
            has_rings: rng.gen_bool(0.45),
        },
    }
}


fn approximate_equator_temperature(
    heating_mass: f64,
    is_black_hole: bool,
    orbit_radius: f32,
    kind: GeneratedPlanetKind,
    rng: &mut impl Rng,
) -> f32 {
    let base = if is_black_hole || heating_mass <= 0.0 {
        // No luminous primary. Internal heat and any unseen external sources
        // keep the result above absolute zero, but nearly all such worlds are frozen.
        rng.gen_range(-235.0f64..-190.0f64)
    } else {
        let temperate_radius = temperate_orbit_radius(heating_mass) as f64;
        15.0 + 210.0 * (temperate_radius / orbit_radius as f64).ln()
    };

    let atmosphere_adjustment = match kind {
        GeneratedPlanetKind::Volcanic => 85.0,
        GeneratedPlanetKind::SuperEarth => 30.0,
        GeneratedPlanetKind::Ocean => 10.0,
        GeneratedPlanetKind::Neptunian => -25.0,
        GeneratedPlanetKind::GasGiant => -40.0,
        GeneratedPlanetKind::IceWorld => -35.0,
        _ => 0.0,
    };

    (base + atmosphere_adjustment + rng.gen_range(-18.0..18.0))
        .clamp(-250.0, 650.0) as f32
}



fn generate_moon_count<R: Rng>(
    rng: &mut R,
    kind: GeneratedPlanetKind,
) -> usize {
    let roll = rng.gen_range(0..100);

    match kind {
        GeneratedPlanetKind::Barren
        | GeneratedPlanetKind::Volcanic
        | GeneratedPlanetKind::Terrestrial
        | GeneratedPlanetKind::Ocean => match roll {
            0..65 => 0,
            65..92 => 1,
            _ => 2,
        },

        GeneratedPlanetKind::SuperEarth => match roll {
            0..50 => 0,
            50..82 => 1,
            82..96 => 2,
            _ => 3,
        },

        GeneratedPlanetKind::IceWorld => match roll {
            0..55 => 0,
            55..85 => 1,
            85..97 => 2,
            _ => 3,
        },

        GeneratedPlanetKind::Neptunian => match roll {
            0..10 => 0,
            10..25 => 1,
            25..45 => 2,
            45..65 => 3,
            65..80 => 4,
            80..90 => 5,
            90..96 => 6,
            _ => rng.gen_range(7..=10),
        },

        GeneratedPlanetKind::GasGiant => match roll {
            0..5 => 0,
            5..12 => 1,
            12..22 => 2,
            22..34 => 3,
            34..47 => 4,
            47..60 => 5,
            60..72 => 6,
            72..82 => 7,
            82..90 => 8,
            90..95 => 9,
            _ => rng.gen_range(10..=16),
        },
    }
}

fn generate_planet_temperature<R: Rng>(
    heating_mass: f64,
    is_black_hole: bool,
    orbit_radius: f32,
    kind: GeneratedPlanetKind,
    rng: &mut R,
) -> PlanetTemperature {
    let equator = approximate_equator_temperature(
        heating_mass,
        is_black_hole,
        orbit_radius,
        kind,
        rng,
    );

    let pole_difference = match kind {
        GeneratedPlanetKind::Ocean => {
            rng.gen_range(15.0f32..45.0f32)
        }

        GeneratedPlanetKind::GasGiant
        | GeneratedPlanetKind::Neptunian => {
            rng.gen_range(20.0f32..55.0f32)
        }

        _ => rng.gen_range(30.0f32..85.0f32),
    };

    let day_difference = match kind {
        GeneratedPlanetKind::GasGiant
        | GeneratedPlanetKind::Neptunian => {
            rng.gen_range(10.0f32..35.0f32)
        }

        GeneratedPlanetKind::Ocean => {
            rng.gen_range(8.0f32..28.0f32)
        }

        _ => rng.gen_range(15.0f32..70.0f32),
    };

    PlanetTemperature {
        pole: (equator - pole_difference)
            .clamp(-260.0, 600.0) as i16,

        equator: equator as i16,

        substellar: (equator + day_difference)
            .clamp(-260.0, 650.0) as i16,

        antistellar: (
            equator
                - day_difference
                - rng.gen_range(5.0f32..30.0f32)
        )
            .clamp(-270.0, 600.0) as i16,
    }
}

fn is_tidally_locked<R: Rng>(
    kind: GeneratedPlanetKind,
    orbit_radius: f32,
    stellar_mass: f64,
    rng: &mut R,
) -> bool {
    if matches!(
        kind,
        GeneratedPlanetKind::GasGiant
            | GeneratedPlanetKind::Neptunian
    ) {
        return false;
    }

    let locking_distance =
        (3.8 * stellar_mass.powf(0.25)) as f32;

    if orbit_radius < locking_distance * 0.65 {
        rng.gen_bool(0.85)
    } else if orbit_radius < locking_distance {
        rng.gen_bool(0.45)
    } else {
        rng.gen_bool(0.04)
    }
}

fn generate_land_fraction<R: Rng>(
    kind: GeneratedPlanetKind,
    rng: &mut R,
) -> Option<f32> {
    match kind {
        GeneratedPlanetKind::Ocean => {
            Some(rng.gen_range(0.0f32..0.15f32))
        }

        GeneratedPlanetKind::Terrestrial => {
            Some(rng.gen_range(0.20f32..0.85f32))
        }

        GeneratedPlanetKind::SuperEarth => {
            Some(rng.gen_range(0.15f32..0.90f32))
        }

        GeneratedPlanetKind::IceWorld => {
            Some(rng.gen_range(0.35f32..0.98f32))
        }

        GeneratedPlanetKind::Barren
        | GeneratedPlanetKind::Volcanic => Some(1.0),

        GeneratedPlanetKind::Neptunian
        | GeneratedPlanetKind::GasGiant => None,
    }
}

fn generate_ring_color(
    kind: GeneratedPlanetKind,
) -> &'static str {
    match kind {
        GeneratedPlanetKind::Neptunian => "#a8c8d4",
        GeneratedPlanetKind::GasGiant => "#c8b691",
        _ => "#aaa49a",
    }
}

fn generate_planet_resources(
    kind: GeneratedPlanetKind,
) -> Vec<&'static str> {
    match kind {
        GeneratedPlanetKind::Barren => vec![
            "Iron",
            "Nickel",
            "Silicates",
        ],

        GeneratedPlanetKind::Volcanic => vec![
            "Sulfur",
            "Heavy metals",
            "Geothermal energy",
        ],

        GeneratedPlanetKind::Terrestrial => vec![
            "Water",
            "Silicates",
            "Rare earths",
        ],

        GeneratedPlanetKind::Ocean => vec![
            "Water",
            "Organic compounds",
            "Thermal energy",
        ],

        GeneratedPlanetKind::SuperEarth => vec![
            "Iron",
            "High-pressure minerals",
            "Rare metals",
        ],

        GeneratedPlanetKind::IceWorld => vec![
            "Water ice",
            "Ammonia",
            "Methane",
        ],

        GeneratedPlanetKind::Neptunian => vec![
            "Hydrogen",
            "Methane",
            "Deuterium",
        ],

        GeneratedPlanetKind::GasGiant => vec![
            "Hydrogen",
            "Helium-3",
            "Ammonia",
        ],
    }
}

fn generate_planet_type_name(
    kind: GeneratedPlanetKind,
    equator_temperature: i16,
) -> &'static str {
    match kind {
        GeneratedPlanetKind::Barren if equator_temperature >= 250 => {
            "Scorched barren world"
        }
        GeneratedPlanetKind::Barren if equator_temperature >= 80 => {
            "Hot barren world"
        }
        GeneratedPlanetKind::Barren if equator_temperature <= -130 => {
            "Frozen barren world"
        }
        GeneratedPlanetKind::Barren => "Barren rocky world",

        GeneratedPlanetKind::Volcanic if equator_temperature >= 250 => {
            "Scorched volcanic world"
        }
        GeneratedPlanetKind::Volcanic => "Volcanic rocky world",

        GeneratedPlanetKind::Terrestrial if equator_temperature >= 80 => {
            "Hot terrestrial world"
        }
        GeneratedPlanetKind::Terrestrial if equator_temperature <= -35 => {
            "Cold terrestrial world"
        }
        GeneratedPlanetKind::Terrestrial => "Temperate terrestrial world",

        GeneratedPlanetKind::Ocean if equator_temperature >= 80 => {
            "Steam ocean world"
        }
        GeneratedPlanetKind::Ocean if equator_temperature <= -35 => {
            "Frozen ocean world"
        }
        GeneratedPlanetKind::Ocean => "Temperate ocean world",

        GeneratedPlanetKind::SuperEarth if equator_temperature >= 250 => {
            "Scorched rocky super-Earth"
        }
        GeneratedPlanetKind::SuperEarth if equator_temperature >= 80 => {
            "Hot rocky super-Earth"
        }
        GeneratedPlanetKind::SuperEarth if equator_temperature <= -35 => {
            "Cold rocky super-Earth"
        }
        GeneratedPlanetKind::SuperEarth => "Temperate rocky super-Earth",

        GeneratedPlanetKind::IceWorld => "Frozen terrestrial world",

        GeneratedPlanetKind::Neptunian if equator_temperature >= 150 => {
            "Hot Neptune"
        }
        GeneratedPlanetKind::Neptunian if equator_temperature <= -100 => {
            "Frozen ice giant"
        }
        GeneratedPlanetKind::Neptunian => "Ice giant",

        GeneratedPlanetKind::GasGiant if equator_temperature >= 500 => {
            "Ultra-hot gas giant"
        }
        GeneratedPlanetKind::GasGiant if equator_temperature >= 150 => {
            "Hot gas giant"
        }
        GeneratedPlanetKind::GasGiant if equator_temperature <= -100 => {
            "Cold gas giant"
        }
        GeneratedPlanetKind::GasGiant => "Gas giant",
    }
}

fn generate_planet_description(
    kind: GeneratedPlanetKind,
    tidally_locked: bool,
    equator_temperature: i16,
) -> &'static str {
    if tidally_locked {
        return "A tidally locked world with permanent day and night hemispheres.";
    }

    if equator_temperature >= 250 {
        return "A scorched world exposed to intense heating from its nearby primary.";
    }

    if equator_temperature <= -130 {
        return "A deeply frozen outer world with weak external heating.";
    }

    match kind {
        GeneratedPlanetKind::Barren => {
            "An airless or thin-atmosphere rocky world marked by impact basins."
        }

        GeneratedPlanetKind::Volcanic => {
            "A geologically active world shaped by lava fields and frequent eruptions."
        }

        GeneratedPlanetKind::Terrestrial => {
            "A rocky world with a substantial atmosphere and varied surface terrain."
        }

        GeneratedPlanetKind::Ocean => {
            "A water-rich planet dominated by deep oceans and scattered landmasses."
        }

        GeneratedPlanetKind::SuperEarth => {
            "A massive rocky world with strong gravity and a dense atmosphere."
        }

        GeneratedPlanetKind::IceWorld => {
            "A cold world covered by extensive ice fields and frozen volatile deposits."
        }

        GeneratedPlanetKind::Neptunian => {
            "A cold ice giant with a deep volatile-rich atmosphere."
        }

        GeneratedPlanetKind::GasGiant => {
            "A massive hydrogen-rich world with layered clouds and powerful storms."
        }
    }
}

struct GeneratedMoonAppearance {
    type_name: &'static str,
    radius: f32,
    color: &'static str,
    secondary_color: Option<&'static str>,
}

fn generate_moon_appearance<R: Rng>(
    rng: &mut R,
    planet_kind: GeneratedPlanetKind,
) -> GeneratedMoonAppearance {
    let roll = rng.gen_range(0..100);

    match planet_kind {
        GeneratedPlanetKind::Volcanic if roll < 45 => {
            GeneratedMoonAppearance {
                type_name: "Volcanic moon",
                radius: rng.gen_range(0.07f32..0.15f32),
                color: "#704238",
                secondary_color: Some("#d77843"),
            }
        }

        GeneratedPlanetKind::Ocean if roll < 30 => {
            GeneratedMoonAppearance {
                type_name: "Ocean moon",
                radius: rng.gen_range(0.09f32..0.16f32),
                color: "#397c9d",
                secondary_color: Some("#89cad7"),
            }
        }

        GeneratedPlanetKind::IceWorld
        | GeneratedPlanetKind::Neptunian
        if roll < 60 =>
            {
                GeneratedMoonAppearance {
                    type_name: "Icy moon",
                    radius: rng.gen_range(0.06f32..0.15f32),
                    color: "#bfd5df",
                    secondary_color: Some("#eef8fa"),
                }
            }

        GeneratedPlanetKind::GasGiant if roll < 25 => {
            GeneratedMoonAppearance {
                type_name: "Volcanic moon",
                radius: rng.gen_range(0.07f32..0.14f32),
                color: "#75483a",
                secondary_color: Some("#dc7541"),
            }
        }

        GeneratedPlanetKind::GasGiant if roll < 60 => {
            GeneratedMoonAppearance {
                type_name: "Icy moon",
                radius: rng.gen_range(0.06f32..0.16f32),
                color: "#c4d9e2",
                secondary_color: Some("#edf6fa"),
            }
        }

        _ if roll < 12 => {
            GeneratedMoonAppearance {
                type_name: "Captured asteroid",
                radius: rng.gen_range(0.035f32..0.075f32),
                color: "#625b55",
                secondary_color: None,
            }
        }

        _ => GeneratedMoonAppearance {
            type_name: "Rocky moon",
            radius: rng.gen_range(0.05f32..0.15f32),
            color: "#878078",
            secondary_color: Some("#b4aaa0"),
        },
    }
}