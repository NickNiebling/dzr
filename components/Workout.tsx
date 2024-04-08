'use client'
import './css/Workout.css'

import {
    Modal,
    ModalOverlay,
    ModalBody,
    ModalHeader,
    ModalFooter,
    ModalContent,
    ModalCloseButton,
    Button,
    Flex,
    Box,
} from '@chakra-ui/react'

import { useDisclosure } from '@chakra-ui/react';

const WorkoutGraphSVG = () => (
    <div>
    <Box as='svg'
    viewBox='0 0 730 100'
    width='100%'
    height={'auto'}
    transform= 'scaleY(-1)'>
    <svg className="WorkoutGraph-module__workoutGraphSVG--5B-H8" data-testid="workoutGraph">
        <path className="WorkoutGraph-module__z1--1KErG" d="M 10 0 L 10 49.5 L 20.10416617158566 49.5 L 20.10416617158566 0 Z"></path>
        <path className="WorkoutGraph-module__z2--476M_" d="M 25.10416617158566 0 L 25.10416617158566 59.40000198 L 26.145833042997687 59.40000198 L 26.145833042997687 0 Z"></path>
        <path className="WorkoutGraph-module__z2--476M_" d="M 31.145833042997687 0 L 31.145833042997687 64.34999802 L 32.18749991440971 64.34999802 L 32.18749991440971 0 Z"></path>
        <path className="WorkoutGraph-module__z3--3WzZQ" d="M 37.18749991440971 0 L 37.18749991440971 80.19000000000001 L 38.22916678582174 80.19000000000001 L 38.22916678582174 0 Z"></path>
        <path className="WorkoutGraph-module__z4--TlVqP" d="M 43.22916678582174 0 L 43.22916678582174 94.04999901000001 L 44.270833657233766 94.04999901000001 L 44.270833657233766 0 Z"></path><path className="WorkoutGraph-module__z1--1KErG" d="M 49.270833657233766 0 L 49.270833657233766 49.5 L 56.354167601446704 49.5 L 56.354167601446704 0 Z"></path><path className="WorkoutGraph-module__z3--3WzZQ" d="M 61.354167601446704 0 L 61.354167601446704 79.20000098999999 L 80.52083548987258 79.20000098999999 L 80.52083548987258 0 Z"></path><path className="WorkoutGraph-module__z1--1KErG" d="M 85.52083548987258 0 L 85.52083548987258 49.5 L 92.6041684271411 49.5 L 92.6041684271411 0 Z"></path><path className="WorkoutGraph-module__z1--1KErG" d="M 97.6041684271411 0 L 97.6041684271411 51.41149497 L 111.3866012191503 59.300999999999995 L 111.3866012191503 0 Z"></path><path className="WorkoutGraph-module__z2--476M_" d="M 111.3866012191503 0 L 111.3866012191503 59.300999999999995 L 128.85416723894667 69.29999307 L 128.85416723894667 0 Z"></path><path className="WorkoutGraph-module__z2--476M_" d="M 133.85416723894667 0 L 133.85416723894667 69.29999901000001 L 146.97916865873827 69.29999901000001 L 146.97916865873827 0 Z"></path><path className="WorkoutGraph-module__z2--476M_" d="M 151.97916865873827 0 L 151.97916865873827 59.40000198 L 189.27083696001137 69.29999307 L 189.27083696001137 0 Z"></path><path className="WorkoutGraph-module__z2--476M_" d="M 194.27083696001137 0 L 194.27083696001137 59.40000198 L 231.5625022404512 74.25 L 231.5625022404512 0 Z"></path><path className="WorkoutGraph-module__z2--476M_" d="M 236.5625022404512 0 L 236.5625022404512 74.25 L 261.7708345836225 74.25 L 261.7708345836225 0 Z"></path><path className="WorkoutGraph-module__z2--476M_" d="M 266.7708345836225 0 L 266.7708345836225 64.49849901 L 301.04166662974524 74.39850099 L 301.04166662974524 0 Z"></path><path className="WorkoutGraph-module__z2--476M_" d="M 306.04166662974524 0 L 306.04166662974524 61.875 L 313.1250005739582 61.875 L 313.1250005739582 0 Z"></path><path className="WorkoutGraph-module__z2--476M_" d="M 318.1250005739582 0 L 318.1250005739582 69.29999901000001 L 325.2083345181711 69.29999901000001 L 325.2083345181711 0 Z"></path><path className="WorkoutGraph-module__z2--476M_" d="M 330.2083345181711 0 L 330.2083345181711 69.29999901000001 L 331.25000138958313 69.29999901000001 L 331.25000138958313 0 Z"></path><path className="WorkoutGraph-module__z2--476M_" d="M 336.25000138958313 0 L 336.25000138958313 69.29999901000001 L 337.29166826099515 69.29999901000001 L 337.29166826099515 0 Z"></path><path className="WorkoutGraph-module__z2--476M_" d="M 342.29166826099515 0 L 342.29166826099515 69.29999901000001 L 343.33333513240717 69.29999901000001 L 343.33333513240717 0 Z"></path><path className="WorkoutGraph-module__z2--476M_" d="M 348.33333513240717 0 L 348.33333513240717 69.29999901000001 L 349.3750020038192 69.29999901000001 L 349.3750020038192 0 Z"></path><path className="WorkoutGraph-module__z2--476M_" d="M 354.3750020038192 0 L 354.3750020038192 69.29999901000001 L 355.4166688752312 69.29999901000001 L 355.4166688752312 0 Z"></path><path className="WorkoutGraph-module__z2--476M_" d="M 360.4166688752312 0 L 360.4166688752312 69.29999901000001 L 367.50000281944415 69.29999901000001 L 367.50000281944415 0 Z"></path><path className="WorkoutGraph-module__z2--476M_" d="M 372.50000281944415 0 L 372.50000281944415 61.875 L 379.5833357567127 61.875 L 379.5833357567127 0 Z"></path><path className="WorkoutGraph-module__z2--476M_" d="M 384.5833357567127 0 L 384.5833357567127 69.29999901000001 L 391.66666970092564 69.29999901000001 L 391.66666970092564 0 Z"></path><path className="WorkoutGraph-module__z2--476M_" d="M 396.66666970092564 0 L 396.66666970092564 69.29999901000001 L 397.70833657233766 69.29999901000001 L 397.70833657233766 0 Z"></path><path className="WorkoutGraph-module__z2--476M_" d="M 402.70833657233766 0 L 402.70833657233766 69.29999901000001 L 403.7500034437497 69.29999901000001 L 403.7500034437497 0 Z"></path><path className="WorkoutGraph-module__z2--476M_" d="M 408.7500034437497 0 L 408.7500034437497 69.29999901000001 L 409.7916703151617 69.29999901000001 L 409.7916703151617 0 Z"></path><path className="WorkoutGraph-module__z2--476M_" d="M 414.7916703151617 0 L 414.7916703151617 69.29999901000001 L 415.8333371865737 69.29999901000001 L 415.8333371865737 0 Z"></path><path className="WorkoutGraph-module__z2--476M_" d="M 420.8333371865737 0 L 420.8333371865737 69.29999901000001 L 421.87500405798573 69.29999901000001 L 421.87500405798573 0 Z"></path><path className="WorkoutGraph-module__z2--476M_" d="M 426.87500405798573 0 L 426.87500405798573 69.29999901000001 L 433.9583380021987 69.29999901000001 L 433.9583380021987 0 Z"></path><path className="WorkoutGraph-module__z2--476M_" d="M 438.9583380021987 0 L 438.9583380021987 61.875 L 446.0416709394672 61.875 L 446.0416709394672 0 Z"></path><path className="WorkoutGraph-module__z2--476M_" d="M 451.0416709394672 0 L 451.0416709394672 69.29999901000001 L 458.12500488368016 69.29999901000001 L 458.12500488368016 0 Z"></path><path className="WorkoutGraph-module__z2--476M_" d="M 463.12500488368016 0 L 463.12500488368016 69.29999901000001 L 464.1666717550922 69.29999901000001 L 464.1666717550922 0 Z"></path><path className="WorkoutGraph-module__z2--476M_" d="M 469.1666717550922 0 L 469.1666717550922 69.29999901000001 L 470.2083386265042 69.29999901000001 L 470.2083386265042 0 Z"></path><path className="WorkoutGraph-module__z2--476M_" d="M 475.2083386265042 0 L 475.2083386265042 69.29999901000001 L 476.2500054979162 69.29999901000001 L 476.2500054979162 0 Z"></path><path className="WorkoutGraph-module__z2--476M_" d="M 481.2500054979162 0 L 481.2500054979162 69.29999901000001 L 482.29167236932824 69.29999901000001 L 482.29167236932824 0 Z"></path><path className="WorkoutGraph-module__z2--476M_" d="M 487.29167236932824 0 L 487.29167236932824 69.29999901000001 L 488.33333924074026 69.29999901000001 L 488.33333924074026 0 Z"></path><path className="WorkoutGraph-module__z2--476M_" d="M 493.33333924074026 0 L 493.33333924074026 69.29999901000001 L 500.4166721780088 69.29999901000001 L 500.4166721780088 0 Z"></path><path className="WorkoutGraph-module__z2--476M_" d="M 505.4166721780088 0 L 505.4166721780088 61.875 L 512.5000051152773 61.875 L 512.5000051152773 0 Z"></path><path className="WorkoutGraph-module__z2--476M_" d="M 517.5000051152773 0 L 517.5000051152773 74.25 L 524.5833380525459 74.25 L 524.5833380525459 0 Z"></path><path className="WorkoutGraph-module__z2--476M_" d="M 529.5833380525459 0 L 529.5833380525459 69.29999901000001 L 536.6666709898144 69.29999901000001 L 536.6666709898144 0 Z"></path><path className="WorkoutGraph-module__z2--476M_" d="M 541.6666709898144 0 L 541.6666709898144 74.25 L 548.750003927083 74.25 L 548.750003927083 0 Z"></path><path className="WorkoutGraph-module__z2--476M_" d="M 553.750003927083 0 L 553.750003927083 69.29999901000001 L 560.8333368643515 69.29999901000001 L 560.8333368643515 0 Z"></path><path className="WorkoutGraph-module__z2--476M_" d="M 565.8333368643515 0 L 565.8333368643515 74.25 L 572.9166698016201 74.25 L 572.9166698016201 0 Z"></path><path className="WorkoutGraph-module__z2--476M_" d="M 577.9166698016201 0 L 577.9166698016201 69.29999901000001 L 585.0000027388886 69.29999901000001 L 585.0000027388886 0 Z"></path><path className="WorkoutGraph-module__z2--476M_" d="M 590.0000027388886 0 L 590.0000027388886 74.25 L 597.0833356761572 74.25 L 597.0833356761572 0 Z"></path><path className="WorkoutGraph-module__z2--476M_" d="M 602.0833356761572 0 L 602.0833356761572 69.29999901000001 L 609.1666686134257 69.29999901000001 L 609.1666686134257 0 Z"></path><path className="WorkoutGraph-module__z2--476M_" d="M 614.1666686134255 0 L 614.1666686134255 61.875 L 621.250001550694 61.875 L 621.250001550694 0 Z"></path><path className="WorkoutGraph-module__z2--476M_" d="M 626.250001550694 0 L 626.250001550694 74.25 L 639.3750009565969 74.25 L 639.3750009565969 0 Z"></path><path className="WorkoutGraph-module__z2--476M_" d="M 644.3750009565969 0 L 644.3750009565969 69.29999901000001 L 651.4583338938654 69.29999901000001 L 651.4583338938654 0 Z"></path><path className="WorkoutGraph-module__z2--476M_" d="M 656.4583338938653 0 L 656.4583338938653 74.25 L 669.5833332997681 74.25 L 669.5833332997681 0 Z"></path><path className="WorkoutGraph-module__z2--476M_" d="M 674.5833332997681 0 L 674.5833332997681 69.29999901000001 L 681.6666662370367 69.29999901000001 L 681.6666662370367 0 Z"></path><path className="WorkoutGraph-module__z2--476M_" d="M 686.6666662370367 0 L 686.6666662370367 74.25 L 699.7916656429395 74.25 L 699.7916656429395 0 Z"></path><path className="WorkoutGraph-module__z2--476M_" d="M 704.7916656429395 0 L 704.7916656429395 69.29999901000001 L 711.8749985802081 69.29999901000001 L 711.8749985802081 0 Z"></path><path className="WorkoutGraph-module__z2--476M_" d="M 716.874998580208 0 L 716.874998580208 64.34999802 L 721.249997886805 59.4 L 721.249997886805 0 Z"></path><path className="WorkoutGraph-module__z1--1KErG" d="M 721.249997886805 0 L 721.249997886805 59.4 L 729.9999999999995 49.5 L 729.9999999999995 0 Z"></path></svg>
    </Box>
    </div>
    
);

function Workout() {
    const { isOpen, onOpen, onClose } = useDisclosure()
    return (
      <>
        <Button onClick={onOpen} bg='rgba(173, 26, 45, 0.95)' color = 'white' size={'xs'}>In The Zone 2 #1</Button>
  
        <Modal isOpen={isOpen} onClose={onClose} size={{ base: 'xs', sm: 'xl', md: '6xl' }}>
          <ModalOverlay/>
          <ModalContent bg={'white'}>
            
            <ModalHeader color={'black'}>Workout Profile</ModalHeader>
            <ModalCloseButton />
            <ModalBody>
              <WorkoutGraphSVG/>
            </ModalBody>
  

            
          </ModalContent>
        </Modal>
      </>
    )
  }

export default Workout;