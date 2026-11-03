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
  title: 'Puncheurs Summer Cup',
  description: 'Welcome to the Puncheurs Summer Cup by DZR, a challenging series of events designed specifically for the Puncheurs, the masters of explosive power and climbing finesse. Test your puncheur skills on four punchy stages taking place every Tuesday 19:20 CET | 1:20 PM EST throughout the month of June.',

  metadataBase: new URL('https://www.dzrracingseries.com/puncheurs-summer-cup/'),

  openGraph: {
    title: 'Puncheurs Summer Cup',
    description: 'Welcome to the Puncheurs Summer Cup by DZR, a challenging series of events designed specifically for the Puncheurs, the masters of explosive power and climbing finesse. Test your puncheur skills on four punchy stages taking place every Tuesday 19:20 CET | 1:20 PM EST throughout the month of June.',
    url: 'https://www.dzrracingseries.com/puncheurs-summer-cup/',
    siteName: 'DZR',
    images: [
      {
        url: '/puncheurs-summer-cup/Puncheurs-Cup.jpeg',
      },
    ],
    type: 'website',
    locale: 'en_US',
  }
}

export default function puncheurssummercuppage() {
  
  return (
    <div style={{backgroundColor:'black'}}>
      <Container maxW={{base: '90%', md: '5xl'}} py={0} mb={20}>
        <SimpleGrid columns={{ base: 1, md: 1 }} spacing={10}>
        <Flex>
            <Image
              rounded={'md'}
              alt={'feature image'}
              src={
                '/puncheurs-summer-cup/Puncheurs-Cup.jpeg'
              }
              objectFit={'contain'}
            />
          </Flex>
          <Stack spacing={4}>

            <Heading color={'white'}>Puncheurs Summer Cup</Heading>
            <Text color={'white'} fontSize={'lg'} whiteSpace="pre-line">
            Welcome to the Puncheurs Summer Cup by DZR, a challenging series of events designed specifically for the Puncheurs, the masters of explosive power and climbing finesse. Test your puncheur skills on five punchy stages taking place every Tuesday 19:25 CET | 1:25 PM EST throughout the month of June.
            </Text>
            <Heading color={'white'} fontSize={'2xl'}>Rules</Heading>
            <ZwiftyFiftyRules />
            <Heading color={'white'} fontSize={'2xl'}>Stages Overview</Heading>
            <Heading color={'white'} fontSize={'md'}>Tuesdays in June @ 19:25 CEST | 1:25 PM EDT</Heading>
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
                    <Td textAlign="center"><Link  color={'orange'} href = 'https://www.zwift.com/events/view/5589078' target='_Blank' isExternal>Stage 1</Link></Td>
                    <Td textAlign="center">2nd</Td>
                    <Td textAlign="center">Richmond</Td>
                    <Td textAlign="center"><Link  color={'orange'} href = 'https://zwiftinsider.com/route/2015-worlds-course/' target='_Blank' isExternal>Cobbled Climbs</Link></Td>
                    <Td textAlign="center">2</Td>
                    <Td textAlign="center">32.8</Td>
                    <Td textAlign="center">318</Td>
                    </Tr>    

                    <Tr>
                    <Td textAlign="center"><Link  color={'orange'} href = 'https://www.zwift.com/events/view/5589080' target='_Blank' isExternal>Stage 2</Link></Td>
                    <Td textAlign="center">9th</Td>
                    <Td textAlign="center">Yorkshire</Td>
                    <Td textAlign="center"><Link  color={'orange'} href = 'https://zwiftinsider.com/route/royal-pump-room-8/' target='_Blank' isExternal>Royal Pump Room 8</Link></Td>
                    <Td textAlign="center">1</Td>
                    <Td textAlign="center">27.7</Td>
                    <Td textAlign="center">490</Td>
                    </Tr>    

                    <Tr>
                    <Td textAlign="center"><Link  color={'orange'} href = 'https://www.zwift.com/events/view/5589081' target='_Blank' isExternal>Stage 3</Link></Td>
                    <Td textAlign="center">16th</Td>
                    <Td textAlign="center">New York</Td>
                    <Td textAlign="center"><Link  color={'orange'} href = 'https://zwiftinsider.com/route/everything-bagel/' target='_Blank' isExternal>Everything Bagel</Link></Td>
                    <Td textAlign="center">1</Td>
                    <Td textAlign="center">34.3</Td>
                    <Td textAlign="center">545</Td>
                    </Tr>   

                    <Tr>
                    <Td textAlign="center"><Link  color={'orange'} href = 'https://www.zwift.com/events/view/5589082' target='_Blank' isExternal>Stage 4</Link></Td>
                    <Td textAlign="center">23rd</Td>
                    <Td textAlign="center">New York</Td>
                    <Td textAlign="center"><Link  color={'orange'} href = 'https://zwiftinsider.com/route/double-parked/' target='_Blank' isExternal>Double Parked</Link></Td>
                    <Td textAlign="center">1</Td>
                    <Td textAlign="center">42.2</Td>
                    <Td textAlign="center">330</Td>
                    </Tr>

                    <Tr>
                    <Td textAlign="center"><Link  color={'orange'} href = 'https://www.zwift.com/events/view/5589083' target='_Blank' isExternal>Stage 5</Link></Td>
                    <Td textAlign="center">30th</Td>
                    <Td textAlign="center">Scotland</Td>
                    <Td textAlign="center"><Link  color={'orange'} href = 'https://zwiftinsider.com/route/the-muckle-yin/' target='_Blank' isExternal>The Muckle Yin</Link></Td>
                    <Td textAlign="center">1</Td>
                    <Td textAlign="center">23.7</Td>
                    <Td textAlign="center">282</Td>
                    </Tr>   
                </Tbody>
                </Table>
            </TableContainer>
            <Heading color={'white'} fontSize={'2xl'}>Route Profiles</Heading>
            <Carousel
              cards={[
                '/puncheurs-summer-cup/Stage1.png',
                '/puncheurs-summer-cup/Stage2.png',
                '/puncheurs-summer-cup/Stage3.png',
                '/puncheurs-summer-cup/Stage4.png',
                '/puncheurs-summer-cup/Stage5.png',
                  ]}
              />

            <Heading color={'white'} fontSize={'2xl'}>Point Structure</Heading>
            <Heading color={'white'} fontSize={'md'}>Best 4 stage results count in the general classification.</Heading>
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
            <Heading color={'white'} fontSize={'2xl'}>Results</Heading>
            <Heading color={'white'} fontSize={'md'}>Keep track of your performance and progress throughout the series on : <Link  color={'orange'} href = 'https://zwiftpower.com/league.php?id=1762' target='_Blank' isExternal>ZwiftPower</Link></Heading>
            
          </Stack>
          
        </SimpleGrid>
      </Container>
    </div>
  )
}