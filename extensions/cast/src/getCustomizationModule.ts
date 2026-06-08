import castHeaderStatusCustomization from './customizations/castHeaderStatusCustomization';

export default function getCustomizationModule() {
  return [
    {
      name: 'default',
      value: castHeaderStatusCustomization,
    },
  ];
}
