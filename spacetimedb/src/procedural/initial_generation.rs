use crate::procedural::galaxy_points::{generate_spiral_system_points, SpiralSystemDistributionOptions};
use crate::tables::data_tables::{Galaxy, StarSystem, SystemMapRole, SystemPrimaryKind, Vec3f};
use crate::types::Vec3;

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
        arm_count: None,
        arm_winding: None,
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
        arm_count: None,
        arm_winding: None,
        companions: None,
        home: Some(false),
    };
    vec![original_galaxy, second_galaxy]
}

pub(crate) fn generate_star_systems(galaxies: Vec<Galaxy>, wanted_amount_of_systems: Vec<usize>) -> Vec<StarSystem> {
    let mut star_systems = Vec::new();

    for i in 0..galaxies.len() {
        let galaxy = &galaxies[i];
        let amount_of_systems = if wanted_amount_of_systems.len() <= i {
            wanted_amount_of_systems[i]
        }else { 1000 };

        let spiral_system_distribution_options = SpiralSystemDistributionOptions::default();

        let points  = generate_spiral_system_points(&spiral_system_distribution_options, amount_of_systems);

        //TODO: add sophisticated logic for name and planets
        let mut id = 0;
        for point in points {
            let name = format!("{} System-{}", galaxy.name,  id);
            id += 1;
            let star_system_placeholder = StarSystem{
                id: name.clone(),
                galaxy_id: galaxy.id.clone(),
                name,
                position: Vec3f {x: point.x, y: 0.0, z: point.z},
                primary_kind: SystemPrimaryKind::Star,
                map_role: SystemMapRole::Standard,
                spectral_type: "Placeholder".to_string(),
                star_color: "#ffd98a".to_string(),
                star_radius: 0.0,
                black_hole: None,
                zone_color: None,
                zone_radius: None,
                zone_strength: None,
                zone_name: None,
                owner_identity: None,
                description: "Placeholder".to_string(),
                faction: "".to_string(),
                population: 0,
            };
            star_systems.push(star_system_placeholder);
        }


    }

    return star_systems;
}