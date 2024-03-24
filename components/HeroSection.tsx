'use client'

import DZR_slogan from '@/app/gasp'
import { motion } from 'framer-motion';

import {
  Container,
  chakra,
  VisuallyHidden,
  Heading,
  Stack,
  Text,
  Circle,
  Popover,
  PopoverTrigger,
  PopoverContent,
  PopoverHeader,
  PopoverArrow,
  keyframes,
  Link,
} from '@chakra-ui/react'

import { FaFacebook, FaTwitter, FaYoutube, FaDiscord } from 'react-icons/fa'
import { ReactNode } from 'react'


const animationKeyframes = keyframes`
  0% { transform: scale(1) rotate(0deg) translateY(0px); border-radius: 100%; }
  10% { transform: scale(0.98) rotate(0deg) translateY(-8px); border-radius: 100%; }
  20% { transform: scale(0.96) rotate(0deg) translateY(-16px); border-radius: 100%; }
  25% { transform: scale(0.95) rotate(0deg) translateY(-20px); border-radius: 100%; }
  30% { transform: scale(0.96) rotate(0deg) translateY(-24px); border-radius: 100%; }
  40% { transform: scale(0.98) rotate(0deg) translateY(-32px); border-radius: 100%; }
  50% { transform: scale(1) rotate(0deg) translateY(-40px); border-radius: 100%; }
  60% { transform: scale(1.02) rotate(0deg) translateY(-32px); border-radius: 100%; }
  70% { transform: scale(1.04) rotate(0deg) translateY(-24px); border-radius: 100%; }
  75% { transform: scale(1.05) rotate(0deg) translateY(-20px); border-radius: 100%; }
  80% { transform: scale(1.04) rotate(0deg) translateY(-16px); border-radius: 100%; }
  90% { transform: scale(1.02) rotate(0deg) translateY(-8px); border-radius: 100%; }
  100% { transform: scale(1) rotate(0deg) translateY(0px); border-radius: 100%; }
`;

const animationKeyframesRev = keyframes`
  0% { transform: scale(1) rotate(0deg) translateY(-40px); border-radius: 100%; }
  10% { transform: scale(1.02) rotate(0deg) translateY(-32px); border-radius: 100%; }
  20% { transform: scale(1.04) rotate(0deg) translateY(-24px); border-radius: 100%; }
  25% { transform: scale(1.05) rotate(0deg) translateY(-20px); border-radius: 100%; }
  30% { transform: scale(1.04) rotate(0deg) translateY(-16px); border-radius: 100%; }
  40% { transform: scale(1.02) rotate(0deg) translateY(-8px); border-radius: 100%; }
  50% { transform: scale(1) rotate(0deg) translateY(0px); border-radius: 100%; }
  60% { transform: scale(.98) rotate(0deg) translateY(-8px); border-radius: 100%; }
  70% { transform: scale(0.96) rotate(0deg) translateY(-16px); border-radius: 100%; }
  75% { transform: scale(0.95) rotate(0deg) translateY(-20px); border-radius: 100%; }
  80% { transform: scale(0.96) rotate(0deg) translateY(-24px); border-radius: 100%; }
  90% { transform: scale(0.98) rotate(0deg) translateY(-32px); border-radius: 100%; }
  100% { transform: scale(1) rotate(0deg) translateY(-40px); border-radius: 100%; }
`;

const animationKeyframesMid = keyframes`
  0% { transform: scale(1) rotate(0deg) translateY(-20px); border-radius: 100%; }
  40% { transform: scale(1) rotate(0deg) translateY(-20px); border-radius: 100%; }
  45% { transform: scale(0.95) rotate(0deg) translateY(-20px); border-radius: 100%; }
  50% { transform: scale(1.25) rotate(0deg) translateY(-20px); border-radius: 100%; }
  55% { transform: scale(0.85) rotate(0deg) translateY(-20px); border-radius: 100%; }
  60% { transform: scale(1) rotate(0deg) translateY(-20px); border-radius: 100%; }
  100% { transform: scale(1) rotate(0deg) translateY(-20px); border-radius: 100%; }
`;

const animationKeyframesRot = keyframes`
  0% { transform: scale(1) rotate(0deg); border-radius: 100%; }
  100% { transform: scale(1) rotate(365deg); border-radius: 100%; }
`;


const animation = `${animationKeyframes} linear 1s infinite`;
const animationRev = `${animationKeyframesRev} linear 1s infinite`;
const animationMid = `${animationKeyframesMid} linear 2s infinite`;
const animationRot = `${animationKeyframesRot} linear 2s infinite`;


export default function HeroSection() {
  return (
    <Container maxW={'5xl'}
    bg={('black')}>
      <Stack
        textAlign={'center'}
        align={'center'}
        spacing={{ base: 8, md: 10 }}
        py={{ base: 10, md: 10 }}
        >
        <Heading
          fontSize={{ base: '2xl', sm: '4xl', md: '6xl' }}
          lineHeight={'110%'}
          textColor='white'>
          
          <Text as ={motion.div} style={{ display: 'inline-block' }} animation={animationMid}>DANISH ZWIFT RACERS</Text>
          
        </Heading>
        <DZR_slogan />
        <Stack direction={'row'} spacing={6}>
        <Popover trigger='hover'>
          <PopoverTrigger>
            <Link href='https://www.facebook.com/groups/358114378652929' target="_blank" _hover={{ transform: 'scale(1.25)'}}>
            <Circle as={motion.div} animation={animationRot} size='50px' bg='#4267B2' color='white'>
            <FaFacebook fontSize = {25}/>
            </Circle>
            </Link>
          </PopoverTrigger>
          <PopoverContent>
              <PopoverArrow />
              <PopoverHeader color='#4267B2'>Join our Facebook Group!</PopoverHeader>
            </PopoverContent>
        </Popover>
         
        <Popover trigger='hover'>
          <PopoverTrigger>
            <Link href='https://discord.gg/FBtCsddbmU' target="_blank" _hover={{ transform: 'scale(1.25)'}}>
            <Circle as={motion.div} animation={animationRot} size='50px' bg='#5865F2' color='white'>
            <FaDiscord fontSize = {25}/>
            </Circle>
            </Link>
          </PopoverTrigger>
          <PopoverContent>
              <PopoverArrow />
              <PopoverHeader color='#5865F2'>Join our Discord Channel!</PopoverHeader>
            </PopoverContent>
        </Popover>
        </Stack>
   
        
      </Stack>
    </Container>
  )
}