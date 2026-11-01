import {
    Box,
    Text,

  } from '@chakra-ui/react'

export default function LoadingSpinner({ label = 'Loading race data...' }: { label?: string }) {
    return (
        <Box
          position="fixed"
          top="50%"
          left="50%"
          transform="translate(-50%, -50%)"
          zIndex="9999"
          display="flex"
          flexDirection="column"
          alignItems="center"
          justifyContent="center"
        >
          <Box
            width="100px" // Size of the spinner
            height="100px" // Size of the spinner
            borderRadius="50%"
            border="8px solid" // Outer border of the bike wheel
            borderColor="white"
            
            position="relative"
            display="flex"
            alignItems="center"
            justifyContent="center"
            overflow="hidden"
            animation="spin 1s linear infinite"
          >
            {/* Inner rim of the bike wheel */}
            <Box
              width="60px"
              height="60px"
              borderRadius="50%"
              border="0px solid" // Inner border
              borderColor="orange.300"
              position="absolute"
            />
            {/* Spokes */}
            {[...Array(12)].map((_, i) => (
              <Box
                key={i}
                position="absolute"
                width="2px"
                height="40px"
                backgroundColor="white"
                transform={`rotate(${i * 30}deg)`}
                top="50%"
                left="50%"
                transformOrigin="0 0"
              />
            ))}
          </Box>
          <Text color="white" mt={4}>{label}</Text>
          <style>
            {`
              @keyframes spin {
                0% { transform: rotate(0deg); }
                100% { transform: rotate(360deg); }
              }
            `}
          </style>
        </Box>
    );
}