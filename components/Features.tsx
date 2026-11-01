'use client'
import './css/Features.css'

import {
  Box,
  Button,
  Container,
  Flex,
  Heading,
  Icon,
  Stack,
  Text,
  useColorModeValue,
  Link,
  Divider,
  Center,
  AbsoluteCenter,
  Circle,
  Card,
  CardBody,
  CardBodyProps,
  CardHeader,
  SimpleGrid,
  SimpleGridProps,
  VStack,
} from '@chakra-ui/react'
import { keyframes } from '@emotion/react'
import { IconType } from 'react-icons';

import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';

import { AiOutlineAim } from "react-icons/ai";
import { MdInfo } from "react-icons/md";
import { seriesMenuIcon } from '@/components/series/SeriesMenuIcons'



interface Props {
  href: string;
  icon: IconType;
  heading: string;
  text1: string;
  text2: string;
}

const CustomCard: React.FC<Props> = ({ href, icon, heading, text1, text2 }) => {
  return (
    <Link href={href} style={{ textDecoration: 'none' }}>
      <Card className='hover-animation' as={motion.div} height='100%' bg={'black'} borderWidth={{ base: '2px', sm: '3px', md: '4px' }} borderRadius="lg" borderColor={'white'}>
        <CardHeader>
          <Flex justify="center" align="center" bg="white" borderRadius="full" p={2} width={{ base: '10', sm: '14', md: '16' }} height={{ base: '10', sm: '14', md: '16' }}>
            <Icon as={icon} boxSize={'90%'} color='black' />
          </Flex>
        </CardHeader>
        <CardBody>
          <Stack align={'start'} spacing={5}>
            <Box mt={2}>
              <Heading size={['sm', 'sm', 'md']} color={'white'}>{heading}</Heading>
              <Text mt={1} fontSize={['small', 'medium', 'medium']} color={'white'} whiteSpace="pre-line" >
                {text1} <br /> {text2}
              </Text>
            </Box>
          </Stack>
        </CardBody>
      </Card>
    </Link>
  );
};

type PublishedSeries = { slug: string; name: string; icon?: string; intro?: string; timeLabel?: string }

export default function Features() {
  const [published, setPublished] = useState<PublishedSeries[]>([])
  useEffect(() => {
    void fetch('/api/series/published', { cache: 'no-store' })
      .then(async (res) => {
        if (!res.ok) return
        const body = await res.json()
        setPublished(Array.isArray(body.series) ? body.series : [])
      })
      .catch(() => setPublished([]))
  }, [])

  return (
    <Container
      maxW="5xl"
      px={{ base: 6, md: 8 }}
      display="flex"
      justifyContent="center"
      alignItems="center"
      flexDirection="column"
    >
      <Stack spacing={4} as={Container} maxW={'3xl'} textAlign={'center'}>
        <Box position='relative' padding='10'>
          <Divider />
        </Box>
      </Stack>
      <Box width={'100%'}>
        <SimpleGrid spacing={4} minChildWidth={{ base: '100%', sm: '280px' }} marginBlockEnd={4}>
          
          <CustomCard href='/about' icon={MdInfo} heading='About DZR' text1='Learn about our community' text2='& memberships.' />
          {published.map((series) => (
            <CustomCard
              key={series.slug}
              href={`/series/${series.slug}`}
              icon={seriesMenuIcon(series.icon)}
              heading={series.name}
              text1={series.intro || ''}
              text2={series.timeLabel || ''}
            />
          ))}
          <CustomCard href='/in-the-zone-2' icon={AiOutlineAim} heading='In The Zone 2' text1='Structured zone 2 group workouts' text2='Saturdays 9:30 CET & 14:30 CET' />
        </SimpleGrid>
      </Box>
    </Container>
  )
}