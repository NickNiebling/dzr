import next from "next";
import { ZwiftyFiftyCalender } from "../the-zwifty-fifty/ZwiftyFiftyCalender";
import { AfterPartyCalender } from "../dzr-after-party/AfterPartyCalender";
import { AfterPartyRacesData } from "../dzr-after-party/AfterPartyRaces";
import { ZwiftyFiftyRacesData } from "../the-zwifty-fifty/ZwiftyFiftyRaces";

export function racePosts() {
    const tzfRaces = ZwiftyFiftyCalender.filter(data => data.raceID !== '');
    const dafRaces = AfterPartyCalender.filter(data => data.raceID !== '');

    // Add raceSeries property to dafRaces
    const dafRaces_ = dafRaces.map(race => {
        const afterPartyRaceData = AfterPartyRacesData.find(data => data.route === race.route);
        if (afterPartyRaceData) {
            return{
            ...race,
            raceSeries: "DZR After Party Series",
            world: afterPartyRaceData.world,
            laps: afterPartyRaceData.laps,
            distance: afterPartyRaceData.distance,
            elevation: afterPartyRaceData.elevation,
            finish: afterPartyRaceData.finish,
            linkRoute: afterPartyRaceData.linkRoute,
            }
        } else {
            return race;
        }
    });

    // Add raceSeries property to tzfRaces
    const tzfRaces_ = tzfRaces.map(race => {
        const zwiftyFiftyRaceData = ZwiftyFiftyRacesData.find(data => data.route === race.route);
        if (zwiftyFiftyRaceData) {
            return{
            ...race,
            raceSeries: "The Zwifty Fifty",
            world: zwiftyFiftyRaceData.world,
            laps: zwiftyFiftyRaceData.laps,
            distance: zwiftyFiftyRaceData.length,
            elevation: zwiftyFiftyRaceData.hm,
            finish: '',
            linkRoute: zwiftyFiftyRaceData.linkRoute,
            }
        } else {
            return race;
        }
    });

    const allRaces = tzfRaces_.concat(dafRaces_);

    // Sort allRaces by postDate
    allRaces.sort((a, b) => new Date(a.postDate).getTime() - new Date(b.postDate).getTime());

    // Format postDate to RFC 2822 format
    const formattedRaces = allRaces.map(race => ({
        ...race,
        postDate: new Date(race.postDate).toUTCString() // Convert Date object to a string
    }));

    const Races = formattedRaces as { postDate: string; raceSeries: string; world: string; laps: string; distance: string; elevation: string; finish: string; linkRoute: string; date: string; route: string; raceID: string; }[];

    return Races;
}