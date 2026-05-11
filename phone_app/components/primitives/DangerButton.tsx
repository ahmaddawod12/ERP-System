import React from 'react';
import AppButton, { type AppButtonProps } from './AppButton';

export default function DangerButton(props: Omit<AppButtonProps, 'variant'>) {
  return <AppButton variant="destructive" {...props} />;
}
