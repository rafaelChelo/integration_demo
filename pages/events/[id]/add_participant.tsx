import React, {useState} from "react";
import {useRouter} from "next/router";
import {Form, Formik} from "formik";
import * as Yup from "yup";
import IconButton from "@mui/material/IconButton";
import AddIcon from "@mui/icons-material/Add";
import DeleteIcon from "@mui/icons-material/Delete";
import MuiAccordion, {AccordionProps} from "@mui/material/Accordion";
import MuiAccordionSummary, {AccordionSummaryProps} from "@mui/material/AccordionSummary";
import AccordionDetails from "@mui/material/AccordionDetails";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import {styled} from "@mui/material/styles";
import {useDropzone} from "react-dropzone";
import Papa from "papaparse";

import Card from "@shared/components/common/Card";
import {Button, TextInput} from "@shared/components/common/Forms";
import {useAppDispatch} from "@redux/store";
import {onShowTransaction} from "@redux/actions";
import {useDaos} from "@shared/hooks/daos";
import {upload, uploadJson} from "@helpers/chelo";
import {ArrowForwardIosSharp} from "@mui/icons-material";
import {attach} from "@helpers/contracts";
import {parseCheloTransaction} from "@helpers/chelo";
import {TransactionRequest} from "@ethersproject/providers";
import {calculateGasMargin, getLatestBlock, isProduction} from "@helpers/index";
import {useWeb3React} from "@web3-react/core";
import {ethers} from "ethers";

const Accordion = styled((props: AccordionProps) => (
  <MuiAccordion disableGutters elevation={0} square {...props} />
))(({theme}) => ({
  border: `none`,
  "& .MuiAccordionDetails-root": {
    paddingTop: 9,
    paddingBottom: 3,
    background: "transparent",
  },
  "&:not(:last-child)": {
    borderBottom: 0,
  },
  "&:before": {
    display: "none",
  },
}));

const AccordionSummary = styled((props: AccordionSummaryProps) => (
  <MuiAccordionSummary
    expandIcon={<ArrowForwardIosSharp sx={{fontSize: "0.9rem"}} />}
    {...props}
  />
))(({theme}) => ({
  background: "transparent",
  flexDirection: "row-reverse",
  "& .MuiAccordionSummary-content": {
    marginBottom: "3px",
  },
  "& .MuiAccordionSummary-root .Mui-focusVisible": {
    backgroundColor: "transparent",
  },
}));

type ProposalInfo = {
  targets: string[];
  values: number[];
  calldatas: string[];
  description: string;
  roundId: string;
};

type FormValues = {
  name: string;
  wallet: string;
  image: File | null;
};

const AddParticipant = () => {
  const [uploading, setUploading] = React.useState(false);
  const [membersInfo, setMembersInfo] = React.useState<File>(null);
  const [questions, setQuestions] = useState([{question: "", answer: ""}]);
  const [view, setView] = React.useState("ICL");

  const router = useRouter();
  const {daos, loaded} = useDaos();
  const dispatch = useAppDispatch();
  const {provider, chainId, account} = useWeb3React();
  const {getRootProps, getInputProps} = useDropzone({
    accept: "text/csv",
    maxFiles: 1,
    onDrop: (acceptedFiles) => setMembersInfo(acceptedFiles[0]),
  });

  const dao = daos[daos.length - 1] as MiniDAO;
  const eventId = router.query.id;

  const uploadUsersData = async (
    proposalMeta: MiniDaoProposal["metadata"][]
  ): Promise<string[]> => {
    const files = proposalMeta.map((object, i) => {
      const jsonString = JSON.stringify(object);
      const jsonBlob = new Blob([jsonString], {type: "application/json"});

      return new File([jsonBlob], `metadata.${i}.json`, {
        type: "application/json",
      });
    });

    const cid = await upload(files);

    return proposalMeta.map((_, i) => `${cid}/metadata.${i}.json`);
  };

  const createBatchProposal = (data: ProposalInfo[]) => {
    return parseCheloTransaction({
      to: dao.id,
      signature: "batchPropose(address[][],uint256[][],bytes[][],string[])",
      args: [
        data.map(({targets}) => targets),
        data.map(({values}) => values),
        data.map(({calldatas}) => calldatas),
        data.map(({description}) => description),
      ],
    });
  };

  const isDataTooLarge = async (data: ProposalInfo[]) => {
    const signer = provider.getSigner();
    const transaction = createBatchProposal(data);
    const gasLimit = calculateGasMargin(await signer.estimateGas(transaction));

    const block = await getLatestBlock(chainId as SupportedNetworks);
    const blockGasLimit = block.gasLimit;
    console.log({gasLimit, blockGasLimit});

    return gasLimit.gt(blockGasLimit.mul(70).div(100));
  };

  const findOptimalBatchSize = async (array: ProposalInfo[]) => {
    let batchSize = array.length;
    let isTooLarge = true;

    while (isTooLarge) {
      const batch = array.slice(0, batchSize);
      isTooLarge = await isDataTooLarge(batch);
      if (isTooLarge) {
        batchSize = Math.floor(batchSize / 2);
      }
    }

    return batchSize;
  };

  const onImportSubmit = () => {
    console.log("ON import");
    setUploading(true);
    console.log("set loading");
    try {
      Papa.parse(membersInfo, {
        complete: async (results) => {
          const headers: string[] = results.data[0];
          const data: string[][] = results.data.slice(1);

          const mappedData = data.map((row) => {
            return row.reduce((acc, value, index) => {
              const columnName = headers[index];
              acc[columnName] = value;
              return acc;
            }, {} as Record<string, string>);
          });

          const questionedData = data.map((row, i) => {
            const user = mappedData[i];
            const name = user[`What's your name?`] || "Anonymous";
            const questions = row.reduce((acc, value, index) => {
              const question = headers[index];
              acc.push({question, answer: value});
              return acc;
            }, []);

            if (!user["wallet"] && isProduction()) throw Error("no_wallet");

            return {
              title: "Add member to Talent DAO",
              description: `Member is ${user[`What's your name?`]}`,
              image: "",
              metadata: {
                name,
                wallet: isProduction() ? user["wallet"] : user["wallet"] || account,
                questions,
              },
            } as MiniDaoProposal["metadata"];
          });

          console.log("pasred");
          const tokenContract = attach("ERC20", dao.token.address);
          const cids = await uploadUsersData(questionedData);
          console.log({questionedData, cids, data});

          const proposalsArray: ProposalInfo[] = cids.map((cid, i) => {
            const calldata = tokenContract.interface.encodeFunctionData("mint", [
              questionedData[i].metadata.wallet,
              10,
            ]);

            return {
              targets: [dao.token.address],
              values: [0],
              calldatas: [calldata],
              description: cid,
              roundId: eventId as string,
            };
          });

          const batchSize = await findOptimalBatchSize(proposalsArray);
          let txs: CheloTransactionRequest[] = [];

          for (let i = 0; i < proposalsArray.length; i += batchSize) {
            const batch = proposalsArray.slice(i, i + batchSize);
            const {targets, values, calldatas, descriptions} = batch.reduce(
              (acc, cur) => {
                return {
                  targets: acc.targets.concat([cur.targets]),
                  values: acc.values.concat([cur.values]),
                  calldatas: acc.calldatas.concat([cur.calldatas]),
                  descriptions: acc.descriptions.concat([cur.description]),
                };
              },
              {targets: [], values: [], calldatas: [], descriptions: []} as {
                targets: string[][];
                values: number[][];
                calldatas: string[][];
                descriptions: string[];
              }
            );

            txs = txs.concat({
              to: dao.id,
              signature: "batchPropose(address[][],uint256[][],bytes[][],string[])",
              args: [targets, values, calldatas, descriptions],
            });
          }

          dispatch(
            onShowTransaction({
              txs,
              type: "wallet",
            })
          );
        },
      });
    } catch (err) {
      console.log("File proposals", err);
    }
    setUploading(false);
  };

  const handleNormalSubmit = async (values: FormValues) => {
    setUploading(true);
    const imageCid = values.image ? await upload([values.image]) : "";
    const data: MiniDaoProposal["metadata"] = {
      title: "Add member to Talent DAO",
      description: `Member is ${values.name}`,
      image: imageCid,
      metadata: {
        name: values.name,
        wallet: values.wallet,
        questions,
      },
    };
    const cid = await uploadJson(data);

    try {
      dispatch(
        onShowTransaction({
          txs: [
            {
              to: dao.token.address,
              signature: "mint(address,uint256)",
              args: [values.wallet, 1], //TODO calculate mint amount
            },
          ],
          dao: dao.id,
          type: "chelo",
          metadata: {
            cid,
          },
        })
      );
    } catch (err) {
      console.log(err);
    }
    setUploading(false);
  };

  const toggleView = () => {
    setView(view === "ICL" ? "ACL" : "ICL");
  };

  const addQuestion = () => {
    setQuestions([...questions, {question: "", answer: ""}]);
  };

  const updateQuestion = (index: number, field: keyof typeof questions[0], value: string) => {
    const updatedQuestions = questions.map((q, i) => (i === index ? {...q, [field]: value} : q));
    setQuestions(updatedQuestions);
  };

  const deleteQuestion = (index: number) => {
    setQuestions(questions.filter((_, i) => i !== index));
  };

  console.log({uploading});
  return (
    <>
      <div className="flex flex-col items-center w-full pt-20 pb-4 h-full">
        <div className="w-full mb-20 flex justify-center gap-5">
          {view === "ICL" && (
            <Card className="py-5 flex flex-col justify-between" style={{height: "400px"}}>
              <div className="w-full">
                <div className="border-b border-gray-200 pb-2 w-full flex justify-center">
                  <span className="text-violet-500 font-semibold text-lg">
                    Import Candidate List
                  </span>
                </div>
                <div className="px-5 flex flex-col w-full pt-5">
                  <div className="w-full flex flex-col items-center justify-center">
                    <div
                      {...getRootProps()}
                      className="w-72 flex items-center justify-center border-2 border-gray-400 border-dashed py-2 cursor-pointer my-10"
                    >
                      <input {...getInputProps()} />
                      <p className="text-violet-500">
                        <AddIcon />
                      </p>
                    </div>
                    <Button
                      className="w-72 p-2 bg-violet-500 text-sm text-white rounded-full font-semibold mt-8"
                      onClick={onImportSubmit}
                    >
                      {uploading ? "Uploading..." : "Save"}
                    </Button>
                  </div>
                </div>
              </div>
              <div className="w-full flex justify-end pr-5">
                <Button className="p-2 text-sm text-violet-500 font-semibold" onClick={toggleView}>
                  Use form
                </Button>
              </div>
            </Card>
          )}
          {view === "ACL" && (
            <Card className="w-full flex justify-between items-center py-4">
              <div className="w-full">
                <div className="border-b border-gray-200 pb-2 w-full flex justify-center">
                  <span className="text-violet-500 font-semibold text-lg">Add Candidate List</span>
                </div>
                <div className="flex w-full">
                  <div className="flex flex-col w-1/2">
                    <div className="px-5 flex flex-col w-full px-20 pt-5">
                      <div className="mb-4">
                        <span className="text-violet-500">Details</span>
                      </div>
                      <Formik
                        onSubmit={handleNormalSubmit}
                        initialValues={{
                          name: "",
                          wallet: "",
                          image: null,
                        }}
                        validationSchema={Yup.lazy((values: FormValues) => {
                          return Yup.object({
                            name: Yup.string().required("Principal required"),
                            wallet: (
                              Yup.string().required("User wallet required") as any
                            ).isEthAddress(),
                          });
                        })}
                      >
                        {({errors, ...props}) => {
                          return (
                            <Form className="flex flex-col justify-between w-full">
                              <TextInput
                                white
                                name="name"
                                classes={{root: "w-full mb-4"}}
                                placeholder="First Name"
                              />
                              <TextInput
                                white
                                name="wallet"
                                classes={{root: "w-full"}}
                                placeholder="Wallet Address"
                              />
                              {
                                //<ImageUpload
                                //text="User photo (optional)"
                                //classes={{root: "w-full mt-5"}}
                                //value={props.values.image}
                                //onChange={(file) => props.setFieldValue("image", file)}
                                ///>
                              }
                            </Form>
                          );
                        }}
                      </Formik>
                    </div>
                  </div>
                  <div className="w-1/2 flex flex-col pt-3">
                    <div className="w-full flex items-center ml-5 text-violet-500">
                      <span className="">Questions and Answers</span>
                      <IconButton onClick={addQuestion} color="inherit" size="small">
                        <AddIcon />
                      </IconButton>
                    </div>
                    <div className="flex flex-col w-full overflow-scroll max-h-64">
                      {questions.map(({question, answer}, index) => (
                        <Accordion
                          key={index}
                          sx={{
                            boxShadow: "none",
                            background: "transparent",
                            padding: "0",
                          }}
                        >
                          <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                            <TextInput
                              noFormik
                              white
                              value={question}
                              onChange={(e) => updateQuestion(index, "question", e.target.value)}
                              classes={{root: "w-full"}}
                              placeholder="Question"
                            />
                            <IconButton onClick={() => deleteQuestion(index)} color="secondary">
                              <DeleteIcon />
                            </IconButton>
                          </AccordionSummary>
                          <AccordionDetails>
                            <TextInput
                              noFormik
                              white
                              value={answer}
                              onChange={(e) => updateQuestion(index, "answer", e.target.value)}
                              classes={{root: "w-full mt-1 pl-6 pr-10"}}
                              placeholder="Answer"
                            />
                          </AccordionDetails>
                        </Accordion>
                      ))}
                    </div>
                  </div>
                </div>
                <div className="flex justify-between w-full items-center px-5 pt-5">
                  <Button
                    className="w-72 bg-violet-500 text-sm text-white rounded-full font-semibold p-2"
                    type="submit"
                  >
                    {uploading ? "Uploading..." : "Save"}
                  </Button>
                  <Button className="text-sm text-violet-500 font-semibold" onClick={toggleView}>
                    Use cvs
                  </Button>
                </div>
              </div>
            </Card>
          )}
        </div>
      </div>
    </>
  );
};

export default AddParticipant;
