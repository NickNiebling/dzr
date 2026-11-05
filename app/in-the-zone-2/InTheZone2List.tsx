'use client'
import {
    List,
    ListItem,
    ListIcon,
    Text,
    Stack,
    Heading,
    Wrap,
    Box,
    Divider,
    Link,
    TableContainer,
    Table,
    Thead,
    Th,
    Tr,
    Td,
    Tbody,
  } from '@chakra-ui/react'

  import { InTheZone2Calender } from './InTheZone2Calender';
  
  import { ImFire } from "react-icons/im";
  import { GiGrowth } from "react-icons/gi";
  import { IoRefreshCircle } from "react-icons/io5";
  import { ExternalLinkIcon } from '@chakra-ui/icons'

  import Workout from '@/components/Workout';
  import { WorkoutGraphSVG } from '@/app/in-the-zone-2/workouts/nextWorkout';
  

  interface eventProps {
    nextDate: string;
  }

  export default function InTheZoneList({ nextDate }: eventProps) {
    const nextEvent = InTheZone2Calender.filter(date => date.date === nextDate);
    return (
    <Stack spacing={6}>
        <Heading size={{ base: 'md', sm: 'lg', md: 'xl' }} color = 'white'>Next Workout</Heading>
        {nextEvent.map((event)=>(
                    <TableContainer key={event.eventID1} textAlign="center">
                <Table size='sm' color={'white'} borderColor={'white'} border={'1px'}>
                <Thead >
                    <Tr>
                    <Th textAlign="center" textColor={'white'}>Date</Th>
                    <Th textAlign="center" textColor={'white'}>Duration</Th>
                    <Th textAlign="center" textColor={'white'}>Stress Points</Th>
                    <Th textAlign="center" textColor={'white'}>9:30 CET</Th>
                    <Th textAlign="center" textColor={'white'}>14:30 CET</Th>
                    </Tr>
                </Thead>
                <Tbody>
                    <Tr>
                    <Td textAlign="center">{event.date}</Td>
                    {/*<Link  color={'orange'} href = {`https://whatsonzwift.com/workouts/${event.workout}`} target='_Blank' isExternal>{event.workout}<ExternalLinkIcon mx='2px' /></Link>*/}
                    <Td textAlign="center">{event.duration}</Td>
                    <Td textAlign="center">{event.stressPoints}</Td>
                    <Td textAlign="center"><Link  color={'orange'} href = {`https://www.zwift.com/events/view/${event.eventID1}`} target='_Blank' isExternal>Event Link<ExternalLinkIcon mx='2px' /></Link></Td>
                    <Td textAlign="center"><Link  color={'orange'} href = {`https://www.zwift.com/events/view/${event.eventID2}`} target='_Blank' isExternal>Event Link<ExternalLinkIcon mx='2px' /></Link></Td>
                    </Tr>    
                </Tbody>
                </Table>
            </TableContainer>            
        ))}
        
        <WorkoutGraphSVG/>
        <Heading size={{ base: 'md', sm: 'lg', md: 'xl' }} color='white'>The Talking Test</Heading>
        <Text color='white'>Zones in Zwift workouts are based on FTP and might not always accurately reflect your effort level. Here&apos;s how the talking test can help:</Text>
        <div style={{ display: 'inline-block' }}>
        <TableContainer overflowX="auto" display="inline-block">
                <Table size='sm' color={'white'} borderColor={'white'} border={'1px'}>
                <Thead >
                    <Tr>
                    <Th textAlign="center" textColor={'white'}>Zone</Th>
                    <Th textAlign="left" textColor={'white'}>Talking Test</Th>
                    </Tr>
                </Thead>
                <Tbody>
                    <Tr>
                    <Td textAlign="center">Zone 1</Td>
                    <Td textAlign="left">You can easily maintain a conversation</Td>
                    </Tr>
                    <Tr>
                    <Td textAlign="center">Zone 2</Td>
                    <Td textAlign="left">You can maintain a conversation without feeling breathless or struggle for words</Td>
                    </Tr>   
                    <Tr>
                    <Td textAlign="center">Zone &gt;2</Td>
                    <Td textAlign="left">You find it challenging to speak without pausing for breath or only to utter short phrases</Td>
                    </Tr>    
                </Tbody>
                </Table>
            </TableContainer>
            </div>

        <Box lineHeight={1}>
        <Heading size={{ base: 'md', sm: 'lg', md: 'xl' }} color='white'>Benefits of Zone 2 Training</Heading>
        <Wrap>
            <Text color={'white'} fontSize={'xs'} >Soruce:</Text>     
            <Link color={'orange'} fontSize={'xs'} href={'https://www.trainingpeaks.com/blog/zone-2-training-for-endurance-athletes/'} target='_Blank' isExternal>TrainingPeaks<ExternalLinkIcon mx='2px' /></Link>
        </Wrap>
        </Box>
        <Text color='white'>Zone 2 training targets the sweet spot of aerobic exercise intensity, where you stimulate type 1 muscle fibers and promote mitochondrial growth and function.
         In turn, this will:</Text>

    <List spacing={3} color={'white'} >

        <List spacing={3} color={'white'} >
            <ListItem>
                <ListIcon as={ImFire} color='red' fontSize={'20px'}/>
                Increase your capacity to burn fat, thereby improving endurance and preserving glycogen for peak efforts.
            </ListItem>
            <ListItem>
                <ListIcon as={IoRefreshCircle} color='blue' fontSize={'20px'}/>
                Increase lactate clearing capacity to enhance peak efforts and facilitate faster recovery.
            </ListItem>
        </List>
    </List>
    <Text color='white'>Find all you need to know (probably a bit more than that, actually) about zone 2 training in the excellent video below from
     <Link color={'orange'} href={'https://www.youtube.com/@PeterAttiaMD/videos'} target='_Blank' isExternal> Peter Attia&apos;s</Link> podcast, <Link color={'orange'} href={'https://peterattiamd.com/podcast/'} target='_Blank' isExternal>The Drive</Link>, featuring Pogačar&apos;s coach and internationally
      renowned <Link color={'orange'} href={'https://twitter.com/doctorinigo'} target='_Blank' isExternal>Iñigo San Millán</Link></Text>
    <Divider/>
    </Stack>
    )
  }