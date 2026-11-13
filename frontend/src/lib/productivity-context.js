import { createContext, useContext } from 'react';
export const ProductivityContext = createContext(null);
export const useProductivity = () => useContext(ProductivityContext);
export const localDay = (date = new Date()) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
export const searchText = value => String(value).toLowerCase().normalize('NFKD').replace(/[\u064b-\u065f\u0670]/g, '').replace(/[أإآ]/g, 'ا').replace(/ى/g, 'ي');
