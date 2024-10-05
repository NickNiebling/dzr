import ZwiftyFiftyRules from '../the-zwifty-fifty/ZwiftyFiftyRules';
import Carousel from '../carousel';

import {
  Container,
  SimpleGrid,
  Image,
  Flex,
  Heading,
  Text,
  Stack,
  Table,
  Thead,
  Tbody,
  Tr,
  Th,
  Td,
  TableContainer,
  Link,
} from '@chakra-ui/react'


import { Metadata } from "next";

export const metadata: Metadata = {
  title: 'STAGES by DZR',
  description: 'Welcome to STAGES by DZR: Stage Racing Done Right. A very challenging stage race to fill out the gap between ZRL rounds 1 and 2. The winner is the rider finishing all four stages using the least time (as it should be!). As a new feature, riders finishing within 3 seconds will be noted for the same time. Otherwise, time is won on the initial iTT, on bonus sprints in The Sprint, a proper breakaway in The Break Away, and on the hill finish in The Hill. Bonus seconds are also awarded at the finish line of The Sprint, The Break Away, and The Hill.',

  metadataBase: new URL('https://www.dzrracingseries.com/stages/'),

  openGraph: {
    title: 'STAGES by DZR',
    description: 'Welcome to STAGES by DZR: Stage Racing Done Right. A very challenging stage race to fill out the gap between ZRL rounds 1 and 2. The winner is the rider finishing all four stages using the least time (as it should be!). As a new feature, riders finishing within 3 seconds will be noted for the same time. Otherwise, time is won on the initial iTT, on bonus sprints in The Sprint, a proper breakaway in The Break Away, and on the hill finish in The Hill. Bonus seconds are also awarded at the finish line of The Sprint, The Break Away, and The Hill.',
    url: 'https://www.dzrracingseries.com/stages/',
    siteName: 'DZR',
    images: [
      {
        url: '/stages/stages.jpeg',
      },
    ],
    type: 'website',
    locale: 'en_US',
  }
}

export default function stagespage() {
  
  return (
    <div style={{backgroundColor:'black'}}>
      <Container maxW={{base: '90%', md: '5xl'}} py={0} mb={20}>
        <SimpleGrid columns={{ base: 1, md: 1 }} spacing={10}>
        <Flex>
            <Image
              rounded={'md'}
              alt={'feature image'}
              src={
                '/stages/stages.jpeg'
              }
              objectFit={'contain'}
            />
          </Flex>
          <Stack spacing={4}>

            <Heading color={'white'}>STAGES by DZR</Heading>
            <Text color={'white'} fontSize={'lg'} whiteSpace="pre-line">
            Welcome to STAGES by DZR: Stage Racing Done Right.

            A very challenging stage race to fill out the gap between ZRL rounds 1 and 2. The winner is the rider finishing all four stages using the least time (as it should be!). As a new feature, riders finishing within 3 seconds will be noted for the same time. Otherwise, time is won on the initial iTT, on bonus sprints in The Sprint, a proper breakaway in The Break Away, and on the hill finish in The Hill. Bonus seconds are also awarded at the finish line of The Sprint, The Break Away, and The Hill.
            </Text>
            <Heading color={'white'} fontSize={'2xl'}>Rules</Heading>
            <ZwiftyFiftyRules />
            <Heading color={'white'} fontSize={'2xl'}>Stages Overview</Heading>
            <Heading color={'white'} fontSize={'md'}>Tuesdays in June @ 19:20 CEST | 1:20 PM EDT</Heading>
            <TableContainer  textAlign="center">
                <Table size='sm' color={'white'} borderColor={'white'} border={'1px'}>
                <Thead >
                    <Tr>
                    <Th textAlign="center" textColor={'white'}>Race Pass</Th>
                    <Th textAlign="center" textColor={'white'}>Date</Th>
                    <Th textAlign="center" textColor={'white'}>World</Th>
                    <Th textAlign="center" textColor={'white'}>Route</Th>
                    <Th textAlign="center" textColor={'white'}>Laps</Th>
                    <Th textAlign="center" textColor={'white'}>Km</Th>
                    <Th textAlign="center" textColor={'white'}>Hm</Th>
                    </Tr>
                </Thead>
                <Tbody>
                    <Tr>
                    <Td textAlign="center"><Link  color={'orange'} href = 'https://www.zwift.com/uk/events/' target='_Blank' isExternal>Stage 1 - The iTT</Link></Td>
                    <Td textAlign="center">22. October @ 19:20 CEST</Td>
                    <Td textAlign="center">France</Td>
                    <Td textAlign="center"><Link  color={'orange'} href = 'https://zwiftinsider.com/route/champs-elysees/' target='_Blank' isExternal>Champs-Élysées</Link></Td>
                    <Td textAlign="center">1</Td>
                    <Td textAlign="center">9.7</Td>
                    <Td textAlign="center">52</Td>
                    </Tr>    

                    <Tr>
                    <Td textAlign="center"><Link  color={'orange'} href = 'https://www.zwift.com/uk/events/' target='_Blank' isExternal>Stage 2 - The Sprint</Link></Td>
                    <Td textAlign="center">22. October @ 19:45 CEST</Td>
                    <Td textAlign="center">Yorkshire</Td>
                    <Td textAlign="center"><Link  color={'orange'} href = 'https://zwiftinsider.com/route/duchy-estate/' target='_Blank' isExternal>Duchy Estate</Link></Td>
                    <Td textAlign="center">10</Td>
                    <Td textAlign="center">31.7</Td>
                    <Td textAlign="center">435</Td>
                    </Tr>    

                    <Tr>
                    <Td textAlign="center"><Link  color={'orange'} href = 'https://www.zwift.com/uk/events/' target='_Blank' isExternal>Stage 3 - The Break Away</Link></Td>
                    <Td textAlign="center">29. October @ 19:20 CET</Td>
                    <Td textAlign="center">New York</Td>
                    <Td textAlign="center"><Link  color={'orange'} href = 'https://zwiftinsider.com/route/park-perimeter-loop/' target='_Blank' isExternal>Park Perimeter Loop</Link></Td>
                    <Td textAlign="center">4</Td>
                    <Td textAlign="center">40</Td>
                    <Td textAlign="center">500</Td>
                    </Tr>   

                                        <Tr>
                    <Td textAlign="center"><Link  color={'orange'} href = 'https://www.zwift.com/uk/events/' target='_Blank' isExternal>Stage 4 - The Hill</Link></Td>
                    <Td textAlign="center">5. November @ 19:20 CEST</Td>
                    <Td textAlign="center">Watopia</Td>
                    <Td textAlign="center"><Link  color={'orange'} href = 'https://zwiftinsider.com/route/itza-party/' target='_Blank' isExternal>Itza Party</Link></Td>
                    <Td textAlign="center">1</Td>
                    <Td textAlign="center">46</Td>
                    <Td textAlign="center">505</Td>
                    </Tr>    
                </Tbody>
                </Table>
            </TableContainer>
            {/*
            <Heading color={'white'} fontSize={'2xl'}>Route Profiles</Heading>
            <Carousel
              cards={[
                '/puncheurs-summer-cup/Stage1.png',
                '/puncheurs-summer-cup/Stage2.png',
                '/puncheurs-summer-cup/Stage3.png',
                '/puncheurs-summer-cup/Stage4.png',
                  ]}
              />

            <Heading color={'white'} fontSize={'2xl'}>Point Structure</Heading>
            <Heading color={'white'} fontSize={'md'}>Most accumulated points in the four stages takes the overall win</Heading>
            <Heading color={'white'} fontSize={'md'}>Points in the stages are divided according to</Heading>

            <TableContainer  textAlign="center">
                <Table size='sm' color={'white'} borderColor={'white'} border={'1px'}>

                <Tbody>
                <Tr>
                    <Td textAlign="center">Points per race</Td>
                    <Td textAlign="center">60, 57, 55, 54, 53, 52, 51, 50, 49, 48, 47, 46, 45, 44, 43, 42, 41, 40, 39, 38, 37, 36, 35, 34, 33, 32, 31, 30, 29, 28, 27, 26, 25, 24, 23, 22, 21, 20, 19, 18, 17, 16, 15, 14, 13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2 and 1 for everyone else</Td>
                    </Tr>    
                </Tbody>
                </Table>
            </TableContainer>
            */}
            <Heading color={'white'} fontSize={'2xl'}>Results</Heading>
            <Heading color={'white'} fontSize={'md'}>Keep track of your performance and progress throughout the series on : <Link  color={'orange'} href = 'https://zwiftpower.com/league.php?id=2459' target='_Blank' isExternal>ZwiftPower</Link></Heading>
            
          </Stack>
          
        </SimpleGrid>
      </Container>
    </div>
  )
}