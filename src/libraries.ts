export interface Library {
  name: string;
  subdomain: string;
  location: string;
}

export const LIBRARIES: Library[] = [
  { name: "Alameda County Library", subdomain: "aclibrary", location: "Alameda County, CA" },
  { name: "Allegheny County Libraries", subdomain: "acl", location: "Allegheny County, PA" },
  { name: "Arapahoe Libraries", subdomain: "arapahoelibraries", location: "Arapahoe County, CO" },
  { name: "Aurora Public Library", subdomain: "aurora", location: "Aurora, ON, Canada" },
  { name: "Boston Public Library", subdomain: "bpl", location: "Boston, MA" },
  { name: "Brooklyn Public Library", subdomain: "brooklyn", location: "Brooklyn, NY" },
  { name: "Burlington Public Library", subdomain: "burlington", location: "Burlington, ON, Canada" },
  { name: "Burnaby Public Library", subdomain: "burnaby", location: "Burnaby, BC, Canada" },
  { name: "Calgary Public Library", subdomain: "calgary", location: "Calgary, AB, Canada" },
  { name: "Charlotte Mecklenburg Library", subdomain: "cmlibrary", location: "Charlotte, NC" },
  { name: "Chicago Public Library", subdomain: "chipublib", location: "Chicago, IL" },
  { name: "Cincinnati & Hamilton County Public Library", subdomain: "cincinnatilibrary", location: "Cincinnati, OH" },
  { name: "Columbus Metropolitan Library", subdomain: "cml", location: "Columbus, OH" },
  { name: "Dayton Metro Library", subdomain: "dayton", location: "Dayton, OH" },
  { name: "Denver Public Library", subdomain: "denverlibrary", location: "Denver, CO" },
  { name: "Deschutes Public Library", subdomain: "dpl", location: "Deschutes County, OR" },
  { name: "Douglas County Libraries", subdomain: "dcl", location: "Douglas County, CO" },
  { name: "Edmonton Public Library", subdomain: "epl", location: "Edmonton, AB, Canada" },
  { name: "Fulton County Library System", subdomain: "fulcolibrary", location: "Fulton County, GA" },
  { name: "Grand Rapids Public Library", subdomain: "grpl", location: "Grand Rapids, MI" },
  { name: "Halifax Public Libraries", subdomain: "halifax", location: "Halifax, NS, Canada" },
  { name: "Harris County Public Library", subdomain: "hcpl", location: "Houston, TX" },
  { name: "Hennepin County Library", subdomain: "hclib", location: "Minneapolis, MN" },
  { name: "Indianapolis Public Library", subdomain: "indypl", location: "Indianapolis, IN" },
  { name: "Jefferson County Public Library", subdomain: "jeffcolibrary", location: "Jefferson County, CO" },
  { name: "Johnson County Library", subdomain: "jocolibrary", location: "Johnson County, KS" },
  { name: "Kansas City Public Library", subdomain: "kclibrary", location: "Kansas City, MO" },
  { name: "King County Library System", subdomain: "kcls", location: "King County, WA" },
  { name: "Las Vegas-Clark County Library District", subdomain: "lvccld", location: "Las Vegas, NV" },
  { name: "Los Angeles Public Library", subdomain: "lapl", location: "Los Angeles, CA" },
  { name: "Mid-Continent Public Library", subdomain: "mymcpl", location: "Kansas City metro, MO" },
  { name: "Mississauga Library", subdomain: "mississauga", location: "Mississauga, ON, Canada" },
  { name: "Multnomah County Library", subdomain: "multcolib", location: "Portland, OR" },
  { name: "Naperville Public Library", subdomain: "naperlib", location: "Naperville, IL" },
  { name: "New York Public Library", subdomain: "nypl", location: "New York, NY" },
  { name: "Oakland Public Library", subdomain: "oaklandlibrary", location: "Oakland, CA" },
  { name: "Omaha Public Library", subdomain: "omaha", location: "Omaha, NE" },
  { name: "Ottawa Public Library", subdomain: "ottawa", location: "Ottawa, ON, Canada" },
  { name: "Palm Beach County Library System", subdomain: "pbclibrary", location: "Palm Beach County, FL" },
  { name: "Pima County Public Library", subdomain: "pima", location: "Tucson, AZ" },
  { name: "Saint Paul Public Library", subdomain: "sppl", location: "Saint Paul, MN" },
  { name: "San Antonio Public Library", subdomain: "mysapl", location: "San Antonio, TX" },
  { name: "San Diego Public Library", subdomain: "sandiego", location: "San Diego, CA" },
  { name: "San Francisco Public Library", subdomain: "sfpl", location: "San Francisco, CA" },
  { name: "San Jose Public Library", subdomain: "sjpl", location: "San Jose, CA" },
  { name: "San Mateo County Libraries", subdomain: "smcl", location: "San Mateo County, CA" },
  { name: "Santa Clara County Library", subdomain: "sccl", location: "Santa Clara County, CA" },
  { name: "Seattle Public Library", subdomain: "seattle", location: "Seattle, WA" },
  { name: "Sno-Isle Libraries", subdomain: "sno-isle", location: "Snohomish & Island Counties, WA" },
  { name: "St. Louis Public Library", subdomain: "slpl", location: "St. Louis, MO" },
  { name: "Surrey Libraries", subdomain: "surrey", location: "Surrey, BC, Canada" },
  { name: "Tacoma Public Library", subdomain: "tacoma", location: "Tacoma, WA" },
  { name: "Toledo Library", subdomain: "toledo", location: "Toledo, OH" },
  { name: "Toronto Public Library", subdomain: "tpl", location: "Toronto, ON, Canada" },
  { name: "Tulsa City-County Library", subdomain: "tccl", location: "Tulsa, OK" },
  { name: "Vancouver Public Library", subdomain: "vpl", location: "Vancouver, BC, Canada" },
];

export function searchLibraries(query: string): Library[] {
  const q = query.toLowerCase();
  return LIBRARIES.filter(
    (lib) =>
      lib.name.toLowerCase().includes(q) ||
      lib.location.toLowerCase().includes(q) ||
      lib.subdomain.toLowerCase().includes(q)
  ).slice(0, 10);
}

export function findLibrary(subdomain: string): Library | undefined {
  return LIBRARIES.find((lib) => lib.subdomain === subdomain);
}
