'use client'
import React from 'react';
import { AfterPartyRacesData } from './AfterPartyRaces';
import Carousel from '../carousel';
import {useRaceCalendarAPS} from '../api/google/googleSheetsData';
import LoadingSpinner from '@/components/LoadingSpinner';
import { KeepExistingImages, RouteProfilePreview } from '@/components/route-profile/RouteProfilePreview';

import {
    Heading,
    Text,
    Stack,
    Link,
    Divider,
    Spinner,
    Box
  } from '@chakra-ui/react'

import { ExternalLinkIcon } from '@chakra-ui/icons'
import type { PublishedRace } from '../api/google/googleSheetsData';

export default function AfterPartyRaceList() {

    const { calendarDataAPS, loading } = useRaceCalendarAPS();

    // Handle loading state
    if (loading) {
        if (loading) {
            return(
            <LoadingSpinner/>
            )
          }
      }

    const nextRace = calendarDataAPS.filter(data => data.raceID !== '').slice(-1) as PublishedRace[]
    
    return (
        <Stack spacing={6}>
        
                {nextRace.map((nextRace) => {
                const fileRoute = AfterPartyRacesData.find((race) => race.route === nextRace.route)
                const nextRouteDetails = nextRace.catalog
                    ? {
                        world: nextRace.catalog.world || fileRoute?.world || '',
                        route: nextRace.catalog.route || nextRace.route,
                        laps: nextRace.catalog.laps || fileRoute?.laps || '',
                        distance: nextRace.catalog.distance || fileRoute?.distance || '',
                        elevation: nextRace.catalog.elevation || fileRoute?.elevation || '',
                        finish: nextRace.catalog.finish || fileRoute?.finish || '',
                        linkRoute: nextRace.catalog.linkRoute || fileRoute?.linkRoute || '',
                        climbs: nextRace.catalog.climbs || [],
                        customClimbs: nextRace.catalog.customClimbs || [],
                    }
                    : fileRoute
                    ? { ...fileRoute, climbs: [] as string[], customClimbs: [] as { name: string; fromKm: number; toKm: number }[] }
                    : null
                if (!nextRouteDetails) return null
                return (
                    
                    <Stack key={nextRace.date} spacing={6}>
                        <Text color={'white'} fontSize={'md'} align={'center'}>A weekly race series with carefully selected routes all finishing uphill (aka after parties).
                        Check out the coming race below and study the profile to know when to start the sprint. Use Zwift link to join race. Race calendar in menu. <br /><br />
                        Ride on!</Text>
                        <center>
                        <Divider width='50%'/>
                        <br />
                        <Heading as='h1' color={'white'}>{nextRace.date}</Heading>
                        <Heading color={'white'}>17:15 CET | 11:15 AM EST</Heading>
                        <br />
                        <Divider width='50%'/>
                        </center>
                        <center>
                            <Text color={'white'}>World: {nextRouteDetails.world}</Text>  
                            <Text color={'white'}>Route: {nextRouteDetails.route}</Text>  
                            <Text color={'white'}>Laps: {nextRouteDetails.laps}</Text>  
                            <Text color={'white'}>Distance: {nextRouteDetails.distance} km</Text>  
                            <Text color={'white'}>Elevation: {nextRouteDetails.elevation} hm</Text>  
                            <Text color={'white'}>Finish: {nextRouteDetails.finish}</Text>   
                            <Text color={'white'}>Route:{' '} 
                            <Link color={'orange'} href = {nextRouteDetails.linkRoute} target='_Blank' isExternal>{nextRouteDetails.route}<ExternalLinkIcon mx='2px' /></Link>  
                            </Text>
                            <Text color={'white'}>ZwiftPower:{' '}  
                            <Link color={'orange'} href = {`https://zwiftpower.com/events.php?zid=${nextRace.raceID}`} target='_Blank' isExternal>ZwiftPower<ExternalLinkIcon mx='2px' /></Link>                
                            </Text>
                            <Text color={'white'}>Race Pass:{' '}  
                            <Link color={'orange'} href = {`https://www.zwift.com/events/view/${nextRace.raceID}`} target='_Blank' isExternal>Zwift<ExternalLinkIcon mx='2px' /></Link>                
                            </Text>
                            <br />
                            <Divider width='75%'/>
                            <br />
                            <Heading color={'white'}>Profiles</Heading>

                        </center>
                        
                        <KeepExistingImages
                            series="after-party"
                            routeName={nextRouteDetails.route}
                            fallback={
                                <RouteProfilePreview
                                    request={{
                                        world: nextRouteDetails.world,
                                        route: nextRace.catalog?.zwiftRouteName || nextRouteDetails.route,
                                        laps: nextRouteDetails.laps,
                                        distance: nextRouteDetails.distance,
                                        finish: nextRouteDetails.finish,
                                        climbs: nextRouteDetails.climbs,
                                        customClimbs: nextRouteDetails.customClimbs,
                                    }}
                                    showClimbs={nextRouteDetails.climbs.length + nextRouteDetails.customClimbs.length > 0}
                                />
                            }
                        >
                        <Carousel
                            cards={[
                                `/dzr-after-party/${nextRouteDetails.route.toLowerCase().replace(/\s+/g, '-')}/${nextRouteDetails.route.split(' ').join('-')}-profile.png`,
                                `/dzr-after-party/${nextRouteDetails.route.toLowerCase().replace(/\s+/g, '-')}/${nextRouteDetails.route.split(' ').join('-')}-hm.png`,
                                `/dzr-after-party/${nextRouteDetails.route.toLowerCase().replace(/\s+/g, '-')}/${nextRouteDetails.route.split(' ').join('-')}-finish.png`,
                            ]}
   
                        />
                        </KeepExistingImages>
                    </Stack>
                    
                )})}
        </Stack>
    );
}

