//import React from 'react';
import {useAppSelector} from "@redux/store";

type Module = {
  address: string;
  id: string;
};

const ShowMiniDao: React.FC = () => {
  const {daos} = useAppSelector((state) => state.daos);

  return (
    <div className="flex flex-col items-start bg-white rounded-lg shadow-md p-6">
      <span> Mini DAOs</span>
      {daos.map((dao, index: number) => (
        <div key={index} className="mb-4">
          <h2 className="text-xl font-bold mb-2">Base Wallet: {dao.baseWallet}</h2>
          <div className="flex flex-col">
            <h3 className="text-lg font-bold mb-2">Creation block:</h3>
            <span className="">{dao.creationBlock}</span>
          </div>
          <div className="flex flex-col">
            <h3 className="text-lg font-bold mb-2">Modules:</h3>
            {dao.modules.map((module: Module, moduleIndex: number) => (
              <p key={moduleIndex} className="ml-4">
                {module.address}
              </p>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
};

export default ShowMiniDao;
