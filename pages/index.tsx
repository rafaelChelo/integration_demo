import CreateMiniDaoProposal from "@shared/components/app/CreateMiniDaoProposal";
import CastVote from "@shared/components/app/CastVote";
import ExecuteProposal from "@shared/components/app/ExecuteProposal";
import GetMiniDao from "@shared/components/app/GetMiniDao";
import ShowMiniDao from "@shared/components/app/ShowMiniDao";

const MyPage = () => {
  return (
    <div className="flex flex-col">
      <div className="flex w-full">
        <div className="w-1/2 p-4">
          <CreateMiniDaoProposal />
        </div>
        <div className="w-1/2 p-4">
          <CastVote />
        </div>
        <div className="w-1/2 p-4">
          <ExecuteProposal />
        </div>
      </div>
      <div className="flex w-full justify-around mb-10">
        <GetMiniDao />
        <ShowMiniDao />
      </div>
    </div>
  );
};

export default MyPage;
