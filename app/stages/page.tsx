import StagesRules from './stagesrules';
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
    <div>
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
            <Heading color={'white'} fontWeight={'bold'}>🚨 Results from stage 4 are ready on ZwiftPower 🚨</Heading>            
            <Text color={'white'} fontSize={'lg'} whiteSpace="pre-line">
            Welcome to STAGES by DZR: Stage Racing Done Right. {'\n\n'}
            

            A very challenging stage race where the winner is the rider finishing all four stages using the least time (as it should be). {'\n\n'}
            As a new feature, 
            a minimum 3 seconds time gap rule will be applied (iTT excluded) on the finish line. Riders finishing within a 3 seconds time gap will be noted for the same time.{'\n\n'}
            Otherwise, time is won on the initial iTT, on bonus sprints in The Sprint, a proper breakaway in The Break Away, and on the hill finish in The Hill. 
            Bonus seconds are also awarded at the finish line of The Sprint, The Break Away, and The Hill.
            </Text>
            <Heading color={'white'} fontSize={'2xl'}>Rules</Heading>
            <StagesRules />
            <Heading color={'white'} fontSize={'2xl'}>Stages Overview</Heading>
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
                    <Td textAlign="center"><Link  color={'orange'} href = 'https://www.zwift.com/events/view/4544106' target='_Blank' isExternal>Stage 1 - The iTT</Link></Td>
                    <Td textAlign="center">22. October @ 19:20 CEST</Td>
                    <Td textAlign="center">France</Td>
                    <Td textAlign="center"><Link  color={'orange'} href = 'https://zwiftinsider.com/route/champs-elysees/' target='_Blank' isExternal>Champs-Élysées</Link></Td>
                    <Td textAlign="center">1</Td>
                    <Td textAlign="center">9.8</Td>
                    <Td textAlign="center">53</Td>
                    </Tr>    

                    <Tr>
                    <Td textAlign="center"><Link  color={'orange'} href = 'https://www.zwift.com/events/view/4544110' target='_Blank' isExternal>Stage 2 - The Sprint</Link></Td>
                    <Td textAlign="center">22. October @ 19:45 CEST</Td>
                    <Td textAlign="center">Yorkshire</Td>
                    <Td textAlign="center"><Link  color={'orange'} href = 'https://zwiftinsider.com/route/duchy-estate/' target='_Blank' isExternal>Duchy Estate</Link></Td>
                    <Td textAlign="center">10</Td>
                    <Td textAlign="center">31.7</Td>
                    <Td textAlign="center">435</Td>
                    </Tr>    

                    <Tr>
                    <Td textAlign="center"><Link  color={'orange'} href = 'https://www.zwift.com/events/view/4544115' target='_Blank' isExternal>Stage 3 - The Break Away</Link></Td>
                    <Td textAlign="center">29. October @ 19:20 CET</Td>
                    <Td textAlign="center">New York</Td>
                    <Td textAlign="center"><Link  color={'orange'} href = 'https://zwiftinsider.com/route/park-perimeter-loop/' target='_Blank' isExternal>Park Perimeter Loop</Link></Td>
                    <Td textAlign="center">4</Td>
                    <Td textAlign="center">39</Td>
                    <Td textAlign="center">507</Td>
                    </Tr>   

                                        <Tr>
                    <Td textAlign="center"><Link  color={'orange'} href = 'https://www.zwift.com/events/view/4544116' target='_Blank' isExternal>Stage 4 - The Hill</Link></Td>
                    <Td textAlign="center">5. November @ 19:20 CEST</Td>
                    <Td textAlign="center">Watopia</Td>
                    <Td textAlign="center"><Link  color={'orange'} href = 'https://zwiftinsider.com/route/itza-party/' target='_Blank' isExternal>Itza Party</Link></Td>
                    <Td textAlign="center">1</Td>
                    <Td textAlign="center">46.2</Td>
                    <Td textAlign="center">507</Td>
                    </Tr>    
                </Tbody>
                </Table>
            </TableContainer>
           
            <Heading color={'white'} fontSize={'2xl'}>Route Profiles</Heading>
            <Carousel
              cards={[
                '/stages/stage1.jpeg',
                '/stages/stage2.png',
                '/stages/stage3.jpeg',
                '/stages/stage4.png',
                  ]}
              />
             
            <Heading color={'white'} fontSize={'2xl'}>Bonus Seconds</Heading>
            <Heading color={'white'} fontSize={'xl'}>Stage 2</Heading>
            <Heading color={'white'} fontSize={'sm'}>First Across Line (FAL) bonus seconds are awared on segments below</Heading>
            <TableContainer  textAlign="center">
                <Table size='sm' color={'white'} borderColor={'white'} border={'1px'}>
                <Thead>
                    <Tr>
                    <Th textAlign="center" textColor={'white'}>Segment</Th>
                    <Th textAlign="center" textColor={'white'}>Yorkshire Sprint</Th>
                    </Tr>
                </Thead>
                <Tbody>
                <Tr>
                    <Td textAlign="center">Laps</Td>
                    <Td textAlign="center">2 , 4 , 6 , 8</Td>

                </Tr>
                </Tbody>
                </Table>
            </TableContainer>

            <Heading color={'white'} fontSize={'sm'}>Bonus seconds on each sprint are awarded according to</Heading>

            <TableContainer  textAlign="center">
                <Table size='sm' color={'white'} borderColor={'white'} border={'1px'}>
                <Thead>
                    <Tr>
                    <Th textAlign="center" textColor={'white'}>Position</Th>
                    <Th textAlign="center" textColor={'white'}>1</Th>
                    <Th textAlign="center" textColor={'white'}>2</Th>
                    <Th textAlign="center" textColor={'white'}>3</Th>
                    <Th textAlign="center" textColor={'white'}>4</Th>
                    <Th textAlign="center" textColor={'white'}>5</Th>
                    </Tr>
                </Thead>
                <Tbody>
                <Tr>
                    <Td textAlign="center">Bonus Seconds</Td>
                    <Td textAlign="center">10</Td>
                    <Td textAlign="center">8</Td>
                    <Td textAlign="center">6</Td>
                    <Td textAlign="center">4</Td>
                    <Td textAlign="center">2</Td>
                </Tr>
                </Tbody>
                </Table>
            </TableContainer>
            <Heading color={'white'} fontSize={'xl'}>Stage 2, 3 & 4</Heading>
            <Heading color={'white'} fontSize={'sm'}>Bonus seconds are awared to top 5 on the finish line according to</Heading>
            <TableContainer  textAlign="center">
                <Table size='sm' color={'white'} borderColor={'white'} border={'1px'}>
                <Thead>
                    <Tr>
                    <Th textAlign="center" textColor={'white'}>Position</Th>
                    <Th textAlign="center" textColor={'white'}>1</Th>
                    <Th textAlign="center" textColor={'white'}>2</Th>
                    <Th textAlign="center" textColor={'white'}>3</Th>
                    <Th textAlign="center" textColor={'white'}>4</Th>
                    <Th textAlign="center" textColor={'white'}>5</Th>
                    </Tr>
                </Thead>
                <Tbody>
                <Tr>
                    <Td textAlign="center">Bonus Seconds</Td>
                    <Td textAlign="center">10</Td>
                    <Td textAlign="center">8</Td>
                    <Td textAlign="center">6</Td>
                    <Td textAlign="center">4</Td>
                    <Td textAlign="center">2</Td>
                </Tr>
                </Tbody>
                </Table>
            </TableContainer>

            <Heading color={'white'} fontSize={'2xl'}>Results</Heading>
            <Heading color={'white'} fontSize={'md'}>Keep track of your performance and progress throughout the series on : <Link  color={'orange'} href = 'https://zwiftpower.com/league.php?id=2459' target='_Blank' isExternal>ZwiftPower</Link></Heading>
            
          </Stack>
          
        </SimpleGrid>
      </Container>
    </div>
  )
}