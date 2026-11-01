'use client'

import {
  IconButton,
  Box,
  CloseButton,
  Flex,
  HStack,
  Link,
  VStack,
  Icon,
  useColorModeValue,
  Text,
  Drawer,
  DrawerContent,
  useDisclosure,
  BoxProps,
  FlexProps,
  Menu,
  MenuButton,
  MenuDivider,
  MenuItem,
  MenuList,
  Image,
  DrawerOverlay,
  DrawerProps,
  DrawerCloseButton,
} from '@chakra-ui/react'
import {
  FiHome,
  FiTrendingUp,
  FiCompass,
  FiStar,
  FiSettings,
  FiMenu,
  FiBell,
  FiChevronDown,
  FiLogOut,
  FiLogIn,
} from 'react-icons/fi'
import { HamburgerIcon } from '@chakra-ui/icons'
import { MdDirectionsBike, MdInsights, MdInfo, MdCalendarMonth } from "react-icons/md";
import { IconType } from 'react-icons'
import { FaTrophy } from "react-icons/fa6";
import { AiOutlineAim } from "react-icons/ai";
import Sparkles from 'react-sparkle'
import { useEffect, useState } from 'react'
import { useSession, signIn, signOut } from 'next-auth/react'
import { FaUser, FaUserCircle } from 'react-icons/fa'
import { HOLDKAPTAJN_ROLE_ID } from '@/app/lib/sharedConstants'
import { seriesMenuIcon } from '@/components/series/SeriesMenuIcons'

interface LinkItemProps {
  name: string
  href: string
  icon: IconType
  children?: Array<{ name: string; href: string; icon: IconType }>
}

interface NavItemProps extends FlexProps {
  icon: IconType
  href: string
  children: React.ReactNode
}

interface MobileProps extends FlexProps {
  onOpen: () => void
}

interface SidebarProps extends BoxProps {
  onClose: () => void
}

const LinkItems: Array<LinkItemProps> = [
  { name: 'Home', href: '/', icon: MdDirectionsBike },
  {
    name: 'About',
    href: '/about',
    icon: MdInfo,
    children: [{ name: 'Løb', href: '/about/racing', icon: FaTrophy }],
  },
  { name: 'In The Zone 2', href: '/in-the-zone-2', icon: AiOutlineAim },
]

const SidebarContent = ({ onClose, ...rest }: SidebarProps) => {
  const [published, setPublished] = useState<{ slug: string; name: string; icon?: string }[]>([])
  useEffect(() => {
    void fetch('/api/series/published', { cache: 'no-store' })
      .then(async (res) => {
        if (!res.ok) return
        const body = await res.json()
        setPublished(Array.isArray(body.series) ? body.series : [])
      })
      .catch(() => setPublished([]))
  }, [])
  const links: LinkItemProps[] = [
    ...LinkItems,
    ...published.map((series) => ({
      name: series.name,
      href: `/series/${series.slug}`,
      icon: seriesMenuIcon(series.icon),
    })),
  ]
  return (
    <Box
      transition="3s ease"
      bg={('black')}
      borderRight="0px"
      borderRightColor={('red')}
      w={{ base: 'full', md: 'xs' }}
      pos="fixed"
      h="full"
      {...rest}>
      <Flex h="20" alignItems="center" mx="8" justifyContent="space-between">
        <Link href='/'><Image
          display={'flex'}
          boxSize='50px'
          src='/general/DZR_logo.svg'
          alt='DZR logo'
          rounded={'md'}
        />
        </Link>
        <CloseButton display={'flex'} onClick={onClose} color='white' size={'s'} />
      </Flex>
      {links.map((link) => (
        <Box key={link.name}>
          <NavItem icon={link.icon} href={link.href}>
            {link.name}
          </NavItem>
          {link.children?.map((child) => (
            <NavItem key={child.href} icon={child.icon} href={child.href} pl="10">
              {child.name}
            </NavItem>
          ))}
        </Box>
      ))}
    </Box>
  )
}

const NavItem = ({ icon, children, href, ...rest }: NavItemProps) => {
  return (
    <Box
      as="a"
      href={href}
      style={{ textDecoration: 'none' }}
      _focus={{ boxShadow: 'none' }}>
      <Flex
        align="center"
        p="4"
        mx="4"
        borderRadius="lg"
        role="group"
        cursor="pointer"
        color='white'
        fontWeight="900"
        _hover={{
          bg: 'white',
          color: 'black',
        }}
        {...rest}>
        {icon && (
          <Icon
            mr="4"
            fontSize="16"
            _groupHover={{
              color: 'black',
            }}
            as={icon}
          />
        )}
        {children}
      </Flex>
    </Box>
  )
}

// Match left sidebar item styling for the profile drawer
const ProfileNavItem = ({ children, href, onClick, icon }: { children: React.ReactNode; href?: string; onClick?: () => void; icon?: IconType }) => {
  const commonProps = {
    style: { textDecoration: 'none' as const },
  }
  if (href) {
    return (
      <Box as="a" href={href} display={'block'} w={'100%'} {...commonProps}>
        <Flex
          align="center"
          p="4"
          mx="4"
          borderRadius="lg"
          role="group"
          cursor="pointer"
          color={'white'}
          fontWeight="900"
          w={'calc(100% - 2rem)'}
          _hover={{ bg: 'white', color: 'black' }}
        >
          {icon && (
            <Icon
              mr="4"
              fontSize="16"
              _groupHover={{ color: 'black' }}
              as={icon}
            />
          )}
          {children}
        </Flex>
      </Box>
    )
  }
  return (
    <Box as="button" onClick={onClick} display={'block'} w={'100%'} {...commonProps}>
      <Flex
        align="center"
        p="4"
        mx="4"
        borderRadius="lg"
        role="group"
        cursor="pointer"
        color={'white'}
        fontWeight="900"
        w={'calc(100% - 2rem)'}
        _hover={{ bg: 'white', color: 'black' }}
      >
        {icon && (
          <Icon
            mr="4"
            fontSize="16"
            _groupHover={{ color: 'black' }}
            as={icon}
          />
        )}
        {children}
      </Flex>
    </Box>
  )
}

const MobileNav = ({ onOpen, ...rest }: MobileProps) => {
  const { data: session } = useSession()
  const { isOpen: isProfileOpen, onOpen: openProfile, onClose: closeProfile } = useDisclosure()
  const roles: string[] = Array.isArray((session?.user as any)?.roles) ? (session?.user as any).roles : []
  const isAdmin: boolean = Boolean((session?.user as any)?.isAdmin)
  const isCaptain: boolean = roles.includes(HOLDKAPTAJN_ROLE_ID)
  return (
    <Flex
      ml={0}
      px={4}
      height="20"
      alignItems="center"
      position={'fixed'}
      top={0}
      left={0}
      right={0}
      bg={'transparent'}
      zIndex={10}

      borderBottomWidth="0px"
      borderBottomColor={('transparent')}

      justifyContent={'space-between'}

    >

      <IconButton
        display={'flex'}
        onClick={onOpen}
        variant="outline"
        aria-label="open menu"
        bg={('black')}
        borderColor={'black'}
        color={'white'}
        icon={<HamburgerIcon />}
        zIndex={10}
        _hover={{ bg: 'gray.700', borderColor: 'gray.700' }}
        fontSize={{ base: "34px", md: "44px" }}
        fontWeight='900'
      />

      {/* <Image 
          display={'flex'}
          boxSize='50px' 
          src='/general/DZR_logo.svg' 
          alt='DZR logo' 
          />
  */}

      <HStack spacing={{ base: '2', md: '6' }}>
        <IconButton
          display={'flex'}
          aria-label="open profile menu"
          onClick={openProfile}
          variant="outline"
          bg={('black')}
          borderColor={'black'}
          color={'white'}
          icon={<Icon as={FaUserCircle} />}
          zIndex={10}
          _hover={{ bg: 'gray.700', borderColor: 'gray.700' }}
          fontSize={{ base: "34px", md: "44px" }}
          fontWeight='900'
        />
      </HStack>
      <Drawer
        isOpen={isProfileOpen}
        placement="right"
        onClose={closeProfile}
        returnFocusOnClose={true}
        onOverlayClick={closeProfile}
        closeOnOverlayClick={true}
        size={'xs'}
      >
        <DrawerOverlay bg="rgba(173, 26, 45, 0.95)" />
        <DrawerContent bg={'black'}>
          <Box h="full" color={'white'}>
            <Flex h="20" alignItems="center" mx="8" justifyContent="space-between">
              <Link href='/members-zone'><Image
                display={'flex'}
                boxSize='50px'
                src='/general/DZR_logo.svg'
                alt='DZR logo'
                rounded={'md'}
              />
              </Link>
              <CloseButton display={'flex'} onClick={closeProfile} color='white' size={'s'} />
            </Flex>
            {session ? (
              <>
                <ProfileNavItem href="/about" icon={MdInfo}>About</ProfileNavItem>
                <ProfileNavItem href="/about/racing" icon={FaTrophy}>Løb</ProfileNavItem>
                <ProfileNavItem href="/members-zone/racing" icon={FaTrophy}>Racing</ProfileNavItem>
                <ProfileNavItem href="/members-zone/calendar" icon={MdCalendarMonth}>Kalender</ProfileNavItem>
                <ProfileNavItem href="/members-zone/stats-hub" icon={MdInsights}>Stats</ProfileNavItem>
                <ProfileNavItem href="/members-zone/my-pages" icon={FaUserCircle}>My Pages</ProfileNavItem>
                {isAdmin && (
                  <ProfileNavItem href="/admin" icon={FiSettings}>Admin</ProfileNavItem>
                )}
                <ProfileNavItem onClick={() => signOut({ callbackUrl: '/' })} icon={FiLogOut}>Logout</ProfileNavItem>
              </>
            ) : (
              <>
                <ProfileNavItem href="/about" icon={MdInfo}>About</ProfileNavItem>
                <ProfileNavItem href="/about/racing" icon={FaTrophy}>Løb</ProfileNavItem>
                <ProfileNavItem onClick={() => signIn('discord', { callbackUrl: '/members-zone' })} icon={FiLogIn}>Log in</ProfileNavItem>
              </>
            )}
          </Box>
        </DrawerContent>
      </Drawer>

    </Flex>
  )
}

const SidebarWithHeader = () => {
  const { isOpen, onOpen, onClose } = useDisclosure()

  return (
    <Box>
      <SidebarContent onClose={() => onClose} display={'none'} />
      <Drawer
        isOpen={isOpen}
        placement="left"
        onClose={onClose}
        returnFocusOnClose={true}
        onOverlayClick={onClose}
        closeOnOverlayClick={true}
        size={'xs'}
      >
        <DrawerOverlay bg="rgba(173, 26, 45, 0.95)" />
        <DrawerContent>
          <DrawerCloseButton color={'red'} />
          <SidebarContent onClose={onClose} />
        </DrawerContent>
      </Drawer>
      {/* mobilenav */}
      <MobileNav onOpen={onOpen} />
      <Box ml={0} p="0">
        {/* Content */}
      </Box>
    </Box>
  )
}

export default SidebarWithHeader