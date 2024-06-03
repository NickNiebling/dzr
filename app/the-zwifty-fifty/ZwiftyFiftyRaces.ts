export class ZwiftyFiftyRacesTemplate {
  route: string = '';
  world: string = '';
  linkRoute: string = '';
  laps: string = '';
  length: string = '';
  hm: string = '';
  climbs: string[] = [];
  sprints: string[] = [];
  sprintLaps: string[] = [];
  bonus: string[] = [];
      
  constructor(initializer?: any) {
    if (!initializer) return;
    if (initializer.route) this.route = initializer.route;
    if (initializer.world) this.world = initializer.world;
    if (initializer.linkRoute) this.linkRoute = initializer.linkRoute;
    if (initializer.laps) this.laps = initializer.laps;
    if (initializer.length) this.length = initializer.length;
    if (initializer.hm) this.hm = initializer.hm;
    if (initializer.climbs) this.climbs = initializer.climbs;
    if (initializer.sprints) this.sprints = initializer.sprints;
    if (initializer.sprintLaps) this.sprintLaps = initializer.sprintLaps;
    if (initializer.bonus) this.bonus = initializer.bonus;
  }
}

export const ZwiftyFiftyRacesData = [
  new ZwiftyFiftyRacesTemplate({
    route: 'The London Pretzel',
    world: 'London',
    linkRoute: 'https://zwiftinsider.com/route/the-london-pretzel/',
    laps: '1',
    length: '55.6',
    hm: '531',
    climbs: ['Fox Hill', 'Box Hill'],
    sprints: ['Fox Hill','Box Hill'],
    sprintLaps: ['1','1'],
    bonus: ['3.0','2.0','1.0'],
  }),
  new ZwiftyFiftyRacesTemplate({
    route: 'The Muckle Yin',
    world: 'Scotland',
    linkRoute: 'https://zwiftinsider.com/route/the-muckle-yin/',
    laps: '2',
    length: '47',
    hm: '564',    
    climbs: ['Sgurr Summit North','Sgurr Summit South'],
    sprints: ['Sgurr Summit North','Sgurr Summit South'],
    sprintLaps: ['1,2','1,2'],
    bonus: ['1.5','1.0','0.5'],
  }),
  new ZwiftyFiftyRacesTemplate({
    route: '2022 Bambino Fondo',
    world: 'Watopia',
    linkRoute: 'https://zwiftinsider.com/route/2022-bambino-fondo/',
    laps: '1',
    length: '52.3',
    hm: '400',  
    climbs: ['Epic KOM Bypass','Volcano KOM'],
    sprints: ['Watopia Sprint Forward','Fuego Flats Long','Fuego Flats Short','Volcano Circuit Reverse'],
    sprintLaps: ['1','1','1','1'],
    bonus: ['1.5','1.0','0.5'],
  }),
  new ZwiftyFiftyRacesTemplate({
    route: 'Downtown Titans',
    world: 'Watopia',
    linkRoute: 'https://zwiftinsider.com/route/downtown-titans/',
    laps: '2',
    length: '50.09',
    hm: '584',  
    climbs: ['Titans Groove KOM Reverse','Zwift KOM'],
    sprints: ['Titans Groove KOM Reverse','Zwift KOM'],
    sprintLaps: ['1,2','1,2'],
    bonus: ['3.0','2.0','1.0'],
  }),
  new ZwiftyFiftyRacesTemplate({
    route: 'Turf N Surf',
    world: 'Makuri Islands',
    linkRoute: 'https://zwiftinsider.com/route/turf-n-surf/',
    laps: '2',
    length: '49.3',
    hm: '394',  
    climbs: ['Turf N Surf'],
    sprints: ['Shisa Sprint'],
    sprintLaps: ['1,2'],
    bonus: ['3.0','2.0','1.0'],
  }),
  new ZwiftyFiftyRacesTemplate({
    route: '2015 UCI Worlds Course',
    world: 'Richmond',
    linkRoute: 'https://zwiftinsider.com/route/richmond-uci-worlds/',
    laps: '3',
    length: '49',
    hm: '476',  
    climbs: ['Libby 23rd Governor'],
    sprints: ['Broad St'],
    sprintLaps: ['1,2,3'],
    bonus: ['3.0','1.5','1.0'],
  }),
  new ZwiftyFiftyRacesTemplate({
    route: 'Roule Ma Poule',
    world: 'France',
    linkRoute: 'https://zwiftinsider.com/route/roule-ma-poule/',
    laps: '2',
    length: '50.09',
    hm: '418',
    climbs: ['Petit KOM Reverse'],
    sprints: ['Pavé Sprint','Marina Sprint'],
    sprintLaps: ['1,2','1,2'],
    bonus: ['1.5','1.0','0.5'],
  }),
  new ZwiftyFiftyRacesTemplate({
    route: 'Island Hopper',
    world: 'Makuri Islands',
    linkRoute: 'https://zwiftinsider.com/route/island-hopper/',
    laps: '3',
    length: '54.1',
    hm: '387',
    climbs: ['Shisa Sprint Hill'],
    sprints: ['Shisa Sprint'],
    sprintLaps: ['1,2,3'],
    bonus: ['2.0','1.5','1.0'],
  }),
  new ZwiftyFiftyRacesTemplate({
    route: 'RGV',
    world: 'France',
    linkRoute: 'https://zwiftinsider.com/route/rgv/',
    laps: '2',
    length: '49.8',
    hm: '267',
    climbs: [],
    sprints: ['Aqueduc KOM Reverse','Ballon Sprint Reverse'],
    sprintLaps: ['1,2','1,2'],
    bonus: ['3.0','2.0','1.0'],
  }),
  new ZwiftyFiftyRacesTemplate({
    route: 'Innsbruckring',
    world: 'Innsbruck',
    linkRoute: 'https://zwiftinsider.com/route/innsbruckring/',
    laps: '6',
    length: '53',
    hm: '463',
    climbs: ['Leg Snapper KOM'],
    sprints: ['Leg Snapper KOM'],
    sprintLaps: ['1,2,3,4,5,6'],
    bonus: ['1.5','1.0','0.5'],
  }),
  new ZwiftyFiftyRacesTemplate({
    route: 'Spiral Into The Volcano',
    world: 'Watopia',
    linkRoute: 'https://zwiftinsider.com/route/spiral-into-the-volcano/',
    laps: '1',
    length: '55.8',
    hm: '355',
    climbs: ['Volcano KOM'],
    sprints: ['Fuego Flats','Watopia Sprint'],
    sprintLaps: ['1','1'],
    bonus: ['6','4','2'],
  }),
  new ZwiftyFiftyRacesTemplate({
    route: 'Sukis Playground',
    world: 'Makuri Islands',
    linkRoute: 'https://zwiftinsider.com/route/sukis-playground/',
    laps: '3',
    length: '55.1',
    hm: '450',
    climbs: ['Sukis Playground'],
    sprints: ['Country Sprint'],
    sprintLaps: ['1,2,3'],
    bonus: ['3','2','1'],
  }),
  new ZwiftyFiftyRacesTemplate({
    route: 'Bambino Fondo',
    world: 'Watopia',
    linkRoute: 'https://zwiftinsider.com/route/bambino-fondo/',
    laps: '1',
    length: '52.4',
    hm: '580',
    climbs: ['Zwift KOM','Epic KOM start to Windmills','Jungle Banner to Windmills','Volcano KOM'],
    sprints: ['JWB Sprint'],
    sprintLaps: ['1,2'],
    bonus: ['6','4','2'],
  }),
];