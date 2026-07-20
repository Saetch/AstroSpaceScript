import {useTable} from "spacetimedb/react";
import {tables} from "../module_bindings";
import {useEffect, useMemo} from "react";
import {Galaxy as GalaxyRow} from "../module_bindings/types";
import {Galaxy, GalaxyMorphology} from "../domain/universe"
import {Vector3Tuple} from "three";
import {universeRepository} from "./UniverseRepository";

function convertToGalaxy(row: GalaxyRow): Galaxy {
    const inclination = row.inclination
    let inc: Vector3Tuple | undefined = undefined
    if (inclination) {
        inc = [inclination.x, inclination.y, inclination.z]

    }
    return {
        description: row.description,
        discoveredBy: row.discoveredBy,
        estimatedSystems: row.estimatedSystems,
        id: row.id,
        morphology: row.morphology as GalaxyMorphology,
        name: row.name,
        position: [row.position.x, row.position.y, row.position.z],
        primaryColor: row.primaryColor,
        radius: row.radius,
        rotation: row.rotation,
        secondaryColor: row.secondaryColor,
        seed: row.seed,
        thickness: row.thickness,
        armCount: row.armCount,
        armWinding: row.armWinding,
        home: row.home,
        inclination: inc,
        companions: undefined  //TODO: remove this, otherwise companions are disabled
    }

}

export function UniverseSpaceTimeBridge(){
    const [rows, isReady] = useTable(tables.galaxy)


    const galaxies = useMemo(
        () => rows.map(row => {
           return convertToGalaxy(row);
        }), [rows]
    )

    useEffect(() => {

        universeRepository.setGalaxies(galaxies)

    }, [galaxies, isReady])

    return null


}